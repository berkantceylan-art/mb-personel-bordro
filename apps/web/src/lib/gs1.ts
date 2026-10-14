// GS1 / UDI karekod ayrıştırma (ÜTS ürünleri): (01) GTIN · (17) son kullanma · (10) lot · (21) seri · (11) üretim
// Okuyucu çıktısı biçimleri: "]d2" önekli ham veri, GS (\x1d) ayırıcı, parantezli "(01)…(17)…", ya da ayırıcısız düz dizi.
export type Gs1 = { gtin: string; expiry?: string; lot?: string; serial?: string; prod?: string };

const FIXED: Record<string, number> = { "01": 14, "02": 14, "11": 6, "13": 6, "15": 6, "16": 6, "17": 6, "20": 2 };
const VAR = new Set(["10", "21", "240", "241", "30", "37", "22", "250", "251", "235"]);
const GS = "\x1d";

/** YYMMDD → YYYY-MM-DD (gün 00 ise ayın son günü) */
function ymd(v: string): string | undefined {
  if (!/^\d{6}$/.test(v)) return undefined;
  const y = 2000 + Number(v.slice(0, 2)), m = Number(v.slice(2, 4));
  let d = Number(v.slice(4, 6));
  if (m < 1 || m > 12) return undefined;
  if (d === 0) d = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function gtinOk(g: string) {
  if (!/^\d{14}$/.test(g)) return false;
  const sum = g.slice(0, 13).split("").reduce((s, c, i) => s + Number(c) * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === Number(g[13]);
}

export function parseGs1(input: string): Gs1 | null {
  const s = (input ?? "").trim().replace(/^\]([dCQe])\d/, "").replace(/<GS>|\{GS\}|␝/g, GS);
  if (!s) return null;
  const out: Record<string, string> = {};
  if (s.startsWith("(")) {
    for (const m of s.matchAll(/\((\d{2,4})\)([^(]*)/g)) out[m[1]!] = m[2]!.replace(new RegExp(GS, "g"), "").trim();
  } else {
    if (!/^(01|02)\d{14}/.test(s)) return null;
    let i = 0;
    while (i < s.length) {
      if (s[i] === GS) { i++; continue; }
      const ai = [2, 3, 4].map((n) => s.slice(i, i + n)).find((a) => FIXED[a] !== undefined || VAR.has(a));
      if (!ai) break;
      i += ai.length;
      if (FIXED[ai] !== undefined) { out[ai] = s.slice(i, i + FIXED[ai]!); i += FIXED[ai]!; continue; }
      let end = s.indexOf(GS, i);
      if (end < 0) {
        // Ayırıcı düşmüşse: değişken alandan sonra gelebilecek sabit bir AI (17 / 11) arayın
        const rest = s.slice(i);
        const m = rest.match(/^(.{1,20}?)(17|11)(\d{6})(?=$|\x1d|10|21)/);
        end = m && ymd(m[3]!) ? i + m[1]!.length : s.length;
      }
      out[ai] = s.slice(i, end).slice(0, 20);
      i = end;
    }
  }
  const gtin = out["01"] ?? out["02"];
  if (!gtin || !gtinOk(gtin)) return null;
  return { gtin, expiry: out["17"] ? ymd(out["17"]) : undefined, lot: out["10"] || undefined, serial: out["21"] || undefined, prod: out["11"] ? ymd(out["11"]) : undefined };
}
