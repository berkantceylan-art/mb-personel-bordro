/** Dış laboratuvar ekstresi (PDF): "Tarih | İşlem Türü | ÜRÜN | HASTA ADI | BORÇ | ÖDEME | Bakiye" tablosu */
export type OsLine = { date: string | null; kind: "charge" | "payment"; product: string; ref: string; job_no: string | null; amount: number; key: string };
export type OsStatement = { email: string | null; doc_date: string | null; total: number; lines: OsLine[] };

type Cell = { x: number; s: string };
const TR: Record<string, string> = { ı: "I", i: "I", ğ: "G", ü: "U", ş: "S", ö: "O", ç: "C", İ: "I", Ğ: "G", Ü: "U", Ş: "S", Ö: "O", Ç: "C" };
export const osNorm = (s: string | null | undefined) => (s ?? "").replace(/[ıiğüşöçİĞÜŞÖÇ]/g, (c) => TR[c] ?? c).toUpperCase().replace(/[^A-Z0-9]+/g, "");
const money = (s: string) => { const m = s.replace(/\s|TL/g, "").match(/^-?[\d.]+,\d{2}$/); return m ? Math.round(Number(m[0].replace(/\./g, "").replace(",", ".")) * 100) : null; };
const iso = (d: string) => { const m = d.match(/^(\d{2})\.(\d{2})\.(\d{4})$/); return m ? `${m[3]}-${m[2]}-${m[1]}` : null; };

/** Satırları hücrelere böler: harf harf bölünmüş metni (Türkçe karakterler) genişliğe göre birleştirir */
async function pdfCells(buf: Uint8Array): Promise<Cell[][]> {
  const { getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(buf);
  const out: Cell[][] = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const tc = await (await pdf.getPage(p)).getTextContent();
    const rows: { y: number; t: { x: number; w: number; s: string }[] }[] = [];
    for (const it of tc.items as { str?: string; transform: number[]; width?: number }[]) {
      const s = it.str ?? "";
      if (!s.trim()) continue;
      const y = it.transform[5]!;
      let row = rows.find((r) => Math.abs(r.y - y) <= 2);
      if (!row) { row = { y, t: [] }; rows.push(row); }
      row.t.push({ x: it.transform[4]!, w: it.width ?? s.length * 4, s });
    }
    for (const r of rows.sort((a, b) => b.y - a.y)) {
      const cells: Cell[] = [];
      let end = -1e9;
      for (const k of r.t.sort((a, b) => a.x - b.x)) {
        if (k.x - end > 2.5 || !cells.length) cells.push({ x: k.x, s: k.s }); else cells[cells.length - 1]!.s += k.s;
        end = k.x + k.w;
      }
      out.push(cells.map((c) => ({ x: c.x, s: c.s.replace(/\s+/g, " ").trim() })));
    }
  }
  return out;
}

export async function parseOutsourceStatement(buf: Uint8Array): Promise<OsStatement> {
  const rows = await pdfCells(buf);
  const all = rows.map((r) => r.map((c) => c.s).join(" ")).join("\n");
  if (!/EKSTRE/i.test(all) || !/(ÜRÜN|URUN)/i.test(all)) throw new Error("Ekstre biçimi tanınmadı (ÜRÜN / BORÇ sütunlu ekstre bekleniyor).");
  const email = all.match(/[\w.+-]+@[\w-]+\.[\w.]+/)?.[0] ?? null;
  // başlık satırı → sütun konumları
  const h = rows.find((r) => r.some((c) => /^(ÜRÜN|URUN)$/i.test(c.s)) && r.some((c) => /^BOR[CÇ]$/i.test(c.s)));
  if (!h) throw new Error("Ekstre başlık satırı bulunamadı.");
  const at = (re: RegExp) => h.find((c) => re.test(c.s))?.x ?? null;
  const xP = at(/^(ÜRÜN|URUN)$/i)!, xH = at(/HASTA/i) ?? xP + 120, xB = at(/^BOR[CÇ]$/i)!, xO = at(/^[ÖO]DEME$/i) ?? xB + 60, xK = at(/BAK[İI]YE|KPB/i) ?? xO + 50;
  const xT = [...h].filter((c) => c.x < xP - 5).pop()?.x ?? xP - 80;   // ÜRÜN'den önceki sütun (işlem türü)
  const pStart = (xT + xP) / 2 + 8;
  const col = (x: number) => (x < pStart ? "pre" : x < xH - 10 ? "prod" : x < xB - 15 ? "ref" : x < xO - 10 ? "debt" : x < xK - 10 ? "pay" : "bal");
  const lines: OsLine[] = [];
  const seen = new Map<string, number>();
  let docDate: string | null = null;
  for (const r of rows) {
    const d = r.find((c) => /^\d{2}\.\d{2}\.\d{4}$/.test(c.s) && c.x < xP);
    const foot = r.map((c) => c.s).join(" ").match(/^(\d{2}\.\d{2}\.\d{4}) \d{2}:\d{2}/);
    if (foot && r.length <= 4) docDate = iso(foot[1]!);
    if (!d || r === h) continue;
    const g: Record<string, string[]> = { pre: [], prod: [], ref: [], debt: [], pay: [], bal: [] };
    for (const c of r) if (c !== d) g[col(c.x)]!.push(c.s);
    const debt = money(g.debt!.join("")), pay = money(g.pay!.join(""));
    if (debt == null && pay == null) continue;
    const type = g.pre!.filter((s) => !/^\d{1,4}$/.test(s)).join(" ");
    const refText = g.ref!.join(" ");
    const no = refText.match(/\b(\d{4,8})\b/)?.[1] ?? null;
    const ref = refText.replace(no ?? "\u0000", "").trim();
    const kind: OsLine["kind"] = debt == null || /[ÖO]DEME|TAHS[İI]LAT|HAVALE|NAK[İI]T/i.test(type) ? "payment" : "charge";
    const amount = (kind === "charge" ? debt : pay ?? debt) ?? 0;
    const product = g.prod!.join(" ");
    const date = iso(d.s);
    const base = `${date}|${no ?? ""}|${osNorm(product)}|${osNorm(ref)}|${kind}|${amount}`;
    const k = (seen.get(base) ?? 0) + 1; seen.set(base, k);
    lines.push({ date, kind, product, ref, job_no: no, amount, key: `${base}|${k}` });
  }
  if (!lines.length) throw new Error("Ekstrede satır bulunamadı.");
  return { email, doc_date: docDate, total: lines.filter((l) => l.kind === "charge").reduce((a, l) => a + l.amount, 0), lines };
}
