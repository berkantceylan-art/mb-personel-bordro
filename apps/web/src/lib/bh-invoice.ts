/** Bizim Hesap "Satış Raporu" Excel'i → fatura listesi (tarayıcıda çalışır) */
export type BhLine = { name: string; qty: number; unit_price: number; vat_rate: number; unit: string };
export type BhInvoice = { doc_no: string; date: string; due: string | null; customer: string; tax_no: string | null; address: string | null; foreign: boolean;
  currency: "TRY" | "EUR" | "USD" | "GBP" | "CHF"; rate: number; net: number; vat: number; total: number; note: string | null; lines: BhLine[] };

const norm = (v: unknown) => String(v ?? "").trim();
const num = (v: unknown) => (typeof v === "number" ? v : Number(String(v ?? "").replace(/\./g, "").replace(",", ".")) || 0);
const day = (v: unknown) => {
  if (v instanceof Date) return new Date(v.getTime() - v.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const m = norm(v).match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})/);
  return m ? `${m[3]}-${m[2]!.padStart(2, "0")}-${m[1]!.padStart(2, "0")}` : null;
};
const cur = (v: unknown): BhInvoice["currency"] => {
  const s = norm(v).toUpperCase();
  return s === "EUR" || s === "EURO" ? "EUR" : s === "USD" ? "USD" : s === "GBP" ? "GBP" : s === "CHF" ? "CHF" : "TRY";
};

export function parseBhSales(t: unknown[][]): { invoices: BhInvoice[]; cancelled: number; error?: string } {
  const hi = t.findIndex((r) => r.some((c) => norm(c) === "Belge No") && r.some((c) => norm(c) === "Müşteri"));
  if (hi < 0) return { invoices: [], cancelled: 0, error: "Bu dosyada 'Belge No' ve 'Müşteri' sütunları bulunamadı. Bizim Hesap › Satış Raporu Excel'ini yükleyin." };
  const h = t[hi]!.map(norm);
  const col = (n: string) => h.indexOf(n);
  const C = { status: col("Durum"), doc: col("Belge No"), date: col("Tarih"), due: col("Vade"), cust: col("Müşteri"), addr: col("Adres"), tax: col("Vergi No"), note: col("Not"),
    cls: col("Sınıf1"), prod: col("Ürün"), qty: col("Miktar"), unit: col("Birim"), rate: col("Kur"), net: col("Net"), vatp: col("KDV(%)"), vat: col("KDV"), total: col("TOPLAM") };
  const curCol = C.total + 1;
  const map = new Map<string, BhInvoice>();
  let cancelled = 0;
  for (const r of t.slice(hi + 1)) {
    const doc = norm(r[C.doc]).toUpperCase();
    const status = norm(r[C.status]);
    if (!doc || /iptal/i.test(status)) { if (norm(r[C.cust])) cancelled++; continue; }
    const c = cur(r[curCol]);
    let inv = map.get(doc);
    if (!inv) {
      const tax = norm(r[C.tax]).replace(/\D/g, "");
      inv = { doc_no: doc, date: day(r[C.date]) ?? "", due: day(r[C.due]), customer: norm(r[C.cust]), tax_no: tax || null, address: norm(r[C.addr]) || null,
        foreign: /YURTDIŞI|YURTDISI/i.test(norm(r[C.cls])), currency: c, rate: c === "TRY" ? 1 : num(r[C.rate]) || 1, net: 0, vat: 0, total: 0, note: norm(r[C.note]) || null, lines: [] };
      map.set(doc, inv);
    }
    const qty = num(r[C.qty]) || 1;
    const net = Math.round(num(r[C.net]) * 100) / 100;
    const name = norm(r[C.prod]).replace(/^S\d{5}\s+/, "") || "Satış";
    let price = Math.round((net / qty) * 10000) / 10000;
    let q = qty, label = name;
    if (Math.round(q * price * 100) !== Math.round(net * 100)) { q = 1; price = net; label = `${name} (${qty.toLocaleString("tr-TR")} ${norm(r[C.unit]) || "adet"})`; }
    inv.lines.push({ name: label.slice(0, 300), qty: q, unit_price: price, vat_rate: num(r[C.vatp]), unit: (norm(r[C.unit]) || "adet").toLowerCase().slice(0, 20) });
    inv.net += net; inv.vat += num(r[C.vat]); inv.total += num(r[C.total]);
  }
  return { invoices: [...map.values()].filter((i) => i.date && i.lines.length), cancelled };
}
