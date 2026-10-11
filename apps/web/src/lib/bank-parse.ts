/** Banka ekstresi ayrıştırma: Excel / CSV tablosu, CAMT.053 (XML), MT940. Tutarlar kuruş, işaretli (+ giriş). */
export type BankRow = { date: string; description: string; amount: number; balance: number | null; ref: string | null };
export type Mapping = { header: number; date: number; description: number[]; amount: number; debit: number; credit: number; balance: number; ref: number };

const norm = (s: unknown) => String(s ?? "").toLocaleLowerCase("tr-TR").replace(/\s+/g, " ").trim();

/** "1.234,56" · "-1,234.56" · "1234.5" · "(1.234,56)" · "1.234,56 B/A" → kuruş */
export function parseMoney(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return Math.round(v * 100);
  let s = String(v ?? "").trim();
  if (!s) return null;
  let neg = /^\(.*\)$/.test(s) || /^[-−]/.test(s) || /[-−]$/.test(s) || /\bB$|\bborç$/i.test(s);
  s = s.replace(/[()₺$€£\s]|TL|TRY|EUR|USD|[AB]$/gi, "").replace(/^[-−+]|[-−]$/g, "");
  if (/[-−]/.test(s)) { neg = true; s = s.replace(/[-−]/g, ""); }
  const lastComma = s.lastIndexOf(","), lastDot = s.lastIndexOf(".");
  if (lastComma > lastDot) s = s.replace(/\./g, "").replace(",", ".");
  else if (lastDot > lastComma && lastComma >= 0) s = s.replace(/,/g, "");
  else if (lastComma < 0 && (s.match(/\./g) ?? []).length > 1) s = s.replace(/\./g, "");
  else if (lastDot < 0 && lastComma >= 0) s = s.replace(",", ".");
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return Math.round((neg ? -n : n) * 100);
}

/** "31.10.2026" · "31/10/2026" · "2026-10-31" · "31.10.2026 14:22" · Excel seri no · Date → YYYY-MM-DD */
export function parseDate(v: unknown): string | null {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return new Date(Date.UTC(v.getFullYear(), v.getMonth(), v.getDate())).toISOString().slice(0, 10);
  if (typeof v === "number" && v > 20000 && v < 80000) return new Date(Date.UTC(1899, 11, 30) + Math.floor(v) * 86400000).toISOString().slice(0, 10);
  const s = String(v ?? "").trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/);
  if (m) {
    const y = m[3]!.length === 2 ? `20${m[3]}` : m[3]!;
    const d = Number(m[1]), mo = Number(m[2]);
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
  return null;
}

const COLS: Record<Exclude<keyof Mapping, "header" | "description">, RegExp> & { description: RegExp } = {
  date: /^(işlem )?tarih|^tarih|valör|value date|^date|booking date|işlem zamanı/,
  description: /açıklama|aciklama|detay|description|işlem adı|işlem türü|karşı taraf|gönderen|alıcı|narrative|memo/,
  amount: /^(işlem )?tutar|^tutar|amount|miktar/,
  debit: /borç|borc|çıkan|giden|debit|withdrawal/,
  credit: /alacak|giren|gelen|credit|deposit/,
  balance: /bakiye|balance/,
  ref: /dekont|referans|ref|fiş no|işlem no|sıra no/,
};

/** Başlık satırını ve sütunları tahmin et */
export function guessMapping(rows: unknown[][]): Mapping | null {
  for (let h = 0; h < Math.min(rows.length, 40); h++) {
    const cells = (rows[h] ?? []).map(norm);
    const find = (re: RegExp, skip: number[] = []) => cells.findIndex((c, i) => !skip.includes(i) && re.test(c));
    const date = find(COLS.date);
    if (date < 0) continue;
    const balance = find(COLS.balance);
    const amount = find(COLS.amount, [balance]);
    const debit = find(COLS.debit, [balance, amount]);
    const credit = find(COLS.credit, [balance, amount, debit]);
    if (amount < 0 && (debit < 0 || credit < 0)) continue;
    const used = [date, amount, debit, credit, balance];
    const description = cells.map((c, i) => (COLS.description.test(c) && !used.includes(i) ? i : -1)).filter((i) => i >= 0);
    const ref = find(COLS.ref, [...used, ...description]);
    return { header: h, date, description, amount, debit, credit, balance, ref };
  }
  return null;
}

export function rowsFromTable(rows: unknown[][], m: Mapping): BankRow[] {
  const out: BankRow[] = [];
  for (const r of rows.slice(m.header + 1)) {
    const date = parseDate(r[m.date]);
    if (!date) continue;
    let amount: number | null = null;
    if (m.amount >= 0) amount = parseMoney(r[m.amount]);
    if (amount === null && (m.debit >= 0 || m.credit >= 0)) {
      const d = m.debit >= 0 ? parseMoney(r[m.debit]) : null;
      const c = m.credit >= 0 ? parseMoney(r[m.credit]) : null;
      amount = (c ? Math.abs(c) : 0) - (d ? Math.abs(d) : 0);
    }
    if (!amount) continue;
    const description = m.description.map((i) => String(r[i] ?? "").trim()).filter(Boolean).join(" · ").slice(0, 500);
    out.push({ date, description, amount, balance: m.balance >= 0 ? parseMoney(r[m.balance]) : null, ref: m.ref >= 0 ? String(r[m.ref] ?? "").trim().slice(0, 80) || null : null });
  }
  return out;
}

/** CAMT.053 (ISO 20022) XML */
export function parseCamt(xml: string): BankRow[] {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const pick = (el: Element, path: string[]): string => {
    let cur: Element | undefined = el;
    for (const p of path) { cur = Array.from(cur?.children ?? []).find((c) => c.localName === p); if (!cur) return ""; }
    return cur?.textContent?.trim() ?? "";
  };
  return Array.from(doc.getElementsByTagNameNS("*", "Ntry")).map((e) => {
    const amt = Math.round(Number(pick(e, ["Amt"])) * 100);
    const sign = pick(e, ["CdtDbtInd"]) === "DBIT" ? -1 : 1;
    const date = parseDate(pick(e, ["BookgDt", "Dt"]) || pick(e, ["BookgDt", "DtTm"]) || pick(e, ["ValDt", "Dt"])) ?? "";
    const texts = Array.from(e.getElementsByTagNameNS("*", "Ustrd")).map((x) => x.textContent?.trim()).filter(Boolean);
    const names = Array.from(e.getElementsByTagNameNS("*", "Nm")).map((x) => x.textContent?.trim()).filter(Boolean);
    const info = pick(e, ["AddtlNtryInf"]);
    return { date, description: [...names, ...texts, info].filter(Boolean).join(" · ").slice(0, 500), amount: sign * amt, balance: null, ref: pick(e, ["AcctSvcrRef"]) || pick(e, ["NtryRef"]) || null };
  }).filter((r) => r.date && r.amount);
}

/** MT940 (SWIFT) */
export function parseMt940(text: string): BankRow[] {
  const out: BankRow[] = [];
  const lines = text.replace(/\r/g, "").split("\n");
  let cur: BankRow | null = null;
  let inDesc = false;
  for (const line of lines) {
    const m61 = line.match(/^:61:(\d{2})(\d{2})(\d{2})(\d{4})?(R?[CD])([A-Z])?([\d,]+)N?[A-Z]{3}([^/]*)(\/\/(.*))?/);
    if (m61) {
      if (cur) out.push(cur);
      const amt = Math.round(Number(m61[7]!.replace(",", ".")) * 100);
      const debit = m61[5]!.endsWith("D") !== m61[5]!.startsWith("R");
      cur = { date: `20${m61[1]}-${m61[2]}-${m61[3]}`, description: "", amount: debit ? -amt : amt, balance: null, ref: (m61[10] ?? m61[8] ?? "").trim() || null };
      inDesc = false;
      continue;
    }
    if (line.startsWith(":86:") && cur) { cur.description = line.slice(4).trim(); inDesc = true; continue; }
    if (line.startsWith(":")) { inDesc = false; continue; }
    if (inDesc && cur) cur.description = `${cur.description} ${line.trim()}`.slice(0, 500);
  }
  if (cur) out.push(cur);
  return out.map((r) => ({ ...r, description: r.description.replace(/\?\d{2}/g, " ").replace(/\s+/g, " ").trim() }));
}
