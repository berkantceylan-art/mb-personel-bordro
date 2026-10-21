/**
 * Tedarikçi cari ekstresi (Excel) → cari grubu aktarımı.
 *
 * Girdi: çalışma kitabının sayfaları, her biri satır dizisi (xlsx `sheet_to_json(..., { header: 1 })`).
 * Beklenen sayfalar (başlık satırı kendiliğinden bulunur, sütun sırası önemsiz):
 *   "Euro Cari"   → iskontolu fişli cari  (book "slip")
 *   "Peşin Cari"  → iskontosuz fişli cari (book "nodisc")
 *   "Resmi Cari"  → faturalı cari         (book "main")
 *   "KDV Cari"    → KDV carisi            (book "vat")
 *   "Malzeme Kartları" → ürün listesi (ürün adı, cari, birim, son liste fiyatı, son alış)
 * Hareket satırı sütunları: Tarih, Açıklama, Hareket Tipi, Ürün, Miktar, Birim, Liste Fiyatı, Borç, Alacak.
 *
 * Çıktı: kalemli fişler (aynı tarih + belge numarasındaki ALIS satırları bir fiş) ve diğer hareketler.
 * Tutarlar kuruş / cent (tam sayı). Borç = borcumuz artar, Alacak = borcumuz azalır.
 */

export type StmtBook = "main" | "slip" | "nodisc" | "vat";
export type StmtTip = "DEVIR" | "IADE" | "ISKONTO" | "ODEME" | "VIRMAN" | "SENET_IADE" | "FATURA" | "KDV_BORC";

export interface StmtLine { name: string; qty: number; unit: string | null; price: number; amount: number }
export interface StmtSlip { date: string; doc: string | null; note: string | null; lines: StmtLine[] }
export interface StmtMove { date: string; tip: StmtTip; desc: string; debit: number; credit: number }
export interface StmtSection {
  book: StmtBook;
  sheet: string;
  slips: StmtSlip[];
  moves: StmtMove[];
  from: string | null;
  to: string | null;
  /** devir hariç toplamlar ve devir (borç − alacak) */
  debit: number;
  credit: number;
  opening: number;
}
export interface StmtItem { supplier_name: string; unit: string | null; route: "slip" | "nodisc"; price: number | null; currency: string; price_date: string | null }
export interface StmtParse { sections: StmtSection[]; items: StmtItem[]; warnings: string[] }

const BOOK_BY_SHEET: [RegExp, StmtBook][] = [
  [/euro/i, "slip"],
  [/pe[sş]in|iskontosuz/i, "nodisc"],
  [/resmi|fatural/i, "main"],
  [/kdv/i, "vat"],
];

const norm = (s: unknown) =>
  String(s ?? "")
    .toLocaleLowerCase("tr-TR")
    .replace(/[ıi̇]/g, "i")
    .replace(/ş/g, "s").replace(/ğ/g, "g").replace(/ü/g, "u").replace(/ö/g, "o").replace(/ç/g, "c")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** Excel hücresindeki sayı → kuruş. Sayı ya da Türkçe yazılmış metin ("1.234,50") kabul edilir. */
export function cellCents(v: unknown): number {
  if (v === null || v === undefined || v === "") return 0;
  if (typeof v === "number") return Math.round(v * 100);
  const s = String(v).replace(/[€₺\s]|TL|EUR/gi, "");
  if (!s || s === "-") return 0;
  const n = s.includes(",") ? Number(s.replace(/\./g, "").replace(",", ".")) : Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

export function cellNumber(v: unknown): number {
  if (typeof v === "number") return v;
  const s = String(v ?? "").trim();
  if (!s) return 0;
  const n = s.includes(",") ? Number(s.replace(/\./g, "").replace(",", ".")) : Number(s);
  return Number.isFinite(n) ? n : 0;
}

/** Excel tarihi → "YYYY-MM-DD". Date, Excel seri numarası ya da "GG.AA.YYYY" metni. */
export function cellDate(v: unknown): string | null {
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    // xlsx cellDates yerel saatle gece yarısı verir; birkaç saatlik kaymaya karşı en yakın güne yuvarla
    const d = new Date(v.getTime() + 12 * 3600 * 1000);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
  }
  if (typeof v === "number" && v > 20000 && v < 80000) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000);
    return d.toISOString().slice(0, 10);
  }
  const s = String(v ?? "").trim();
  let m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})/);
  if (m) return `${m[3]}-${m[2]!.padStart(2, "0")}-${m[1]!.padStart(2, "0")}`;
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return null;
}

type Cols = Partial<Record<"date" | "doc" | "desc" | "tip" | "item" | "qty" | "unit" | "price" | "debit" | "credit" | "cari" | "last_price" | "last_date", number>>;

function findHeader(rows: unknown[][], need: string[]): { at: number; cols: Cols } | null {
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const r = (rows[i] ?? []).map(norm);
    if (!need.every((n) => r.some((c) => c.startsWith(n)))) continue;
    const cols: Cols = {};
    r.forEach((c, j) => {
      if (c === "tarih") cols.date = j;
      else if (c.startsWith("belge")) cols.doc = j;
      else if (c === "aciklama") cols.desc = j;
      else if (c.startsWith("hareket tipi") || c === "tip") cols.tip = j;
      else if (c.startsWith("urun")) cols.item = j;
      else if (c === "miktar") cols.qty = j;
      else if (c === "birim") cols.unit = j;
      else if (c.startsWith("liste fiyati")) cols.price = j;
      else if (c === "borc") cols.debit = j;
      else if (c === "alacak") cols.credit = j;
      else if (c === "cari") cols.cari = j;
      else if (c.startsWith("son liste fiyati")) cols.last_price = j;
      else if (c === "son alis") cols.last_date = j;
    });
    return { at: i, cols };
  }
  return null;
}

const TIPS: StmtTip[] = ["DEVIR", "IADE", "ISKONTO", "ODEME", "VIRMAN", "SENET_IADE", "FATURA", "KDV_BORC"];

function toTip(raw: string, book: StmtBook, debit: number, credit: number, desc: string): StmtTip | "ALIS" {
  const t = norm(raw).toUpperCase().replace(/\s+/g, "_");
  if (t === "ALIS") return "ALIS";
  if ((TIPS as string[]).includes(t)) return t as StmtTip;
  // tip sütunu yoksa açıklamadan tahmin
  const d = norm(desc);
  if (d.includes("devir")) return "DEVIR";
  if (d.includes("iskonto")) return "ISKONTO";
  if (d.includes("virman")) return "VIRMAN";
  if (d.includes("faturaniz")) return "IADE";
  if (d.includes("iade") && debit > 0) return "SENET_IADE";
  if (book === "vat" && debit > 0) return "KDV_BORC";
  if (book === "main" && debit > 0) return "FATURA";
  return credit > 0 ? "ODEME" : "FATURA";
}

export function parseStatementWorkbook(sheets: Record<string, unknown[][]>): StmtParse {
  const sections: StmtSection[] = [];
  const warnings: string[] = [];
  let items: StmtItem[] = [];

  for (const [name, rows] of Object.entries(sheets)) {
    if (/malzeme|urun|ürün/i.test(name)) {
      items = parseItems(rows, warnings);
      continue;
    }
    const book = BOOK_BY_SHEET.find(([re]) => re.test(name))?.[1];
    if (!book) continue;
    const h = findHeader(rows, ["tarih", "borc", "alacak"]);
    if (!h || h.cols.date === undefined || h.cols.debit === undefined || h.cols.credit === undefined) {
      warnings.push(`"${name}" sayfasında başlık satırı (Tarih, Borç, Alacak) bulunamadı.`);
      continue;
    }
    const c = h.cols;
    const cDate = h.cols.date, cDebit = h.cols.debit, cCredit = h.cols.credit;
    const sec: StmtSection = { book, sheet: name, slips: [], moves: [], from: null, to: null, debit: 0, credit: 0, opening: 0 };
    const slipByKey = new Map<string, StmtSlip>();
    let lastDate: string | null = null;
    let lastDoc: string | null = null;
    let lastDesc = "";
    for (let i = h.at + 1; i < rows.length; i++) {
      const r = rows[i] ?? [];
      const date: string | null = cellDate(r[cDate]);
      const debit = cellCents(r[cDebit]);
      const credit = cellCents(r[cCredit]);
      const item = c.item !== undefined ? String(r[c.item] ?? "").trim() : "";
      if (!date && !debit && !credit && !item) continue;
      const rowDate: string | null = date ?? lastDate;
      if (!rowDate) { warnings.push(`"${name}" ${i + 1}. satırda tarih yok, atlandı.`); continue; }
      const doc: string | null = c.doc !== undefined && r[c.doc] !== "" && r[c.doc] != null ? String(r[c.doc]) : date ? null : lastDoc;
      const desc = String((c.desc !== undefined ? r[c.desc] : "") ?? "").trim() || (date ? "" : lastDesc);
      lastDate = rowDate; lastDoc = doc; lastDesc = desc;
      const tip = toTip(String(c.tip !== undefined ? r[c.tip] ?? "" : item ? "ALIS" : ""), book, debit, credit, desc);
      if (!sec.from || rowDate < sec.from) sec.from = rowDate;
      if (!sec.to || rowDate > sec.to) sec.to = rowDate;
      if (tip === "DEVIR") { sec.opening += debit - credit; sec.moves.push({ date: rowDate, tip, desc: desc || "Devir", debit, credit }); continue; }
      sec.debit += debit; sec.credit += credit;
      if (tip === "ALIS" && item && debit > 0) {
        const key = `${rowDate}|${doc ?? ""}|${desc}`;
        let s = slipByKey.get(key);
        if (!s) { s = { date: rowDate, doc: null, note: desc || null, lines: [] }; slipByKey.set(key, s); sec.slips.push(s); }
        const qty = c.qty !== undefined ? cellNumber(r[c.qty]) : 1;
        s.lines.push({ name: item, qty: qty || 1, unit: c.unit !== undefined ? String(r[c.unit] ?? "").trim() || null : null, price: c.price !== undefined ? cellCents(r[c.price]) : debit, amount: debit });
        continue;
      }
      const t: StmtTip = tip === "ALIS" ? (credit > 0 ? "IADE" : "FATURA") : tip;
      sec.moves.push({ date: rowDate, tip: t, desc: [desc, item].filter(Boolean).join(" · ") || t, debit, credit });
    }
    sections.push(sec);
  }
  const order: StmtBook[] = ["main", "slip", "nodisc", "vat"];
  sections.sort((a, b) => order.indexOf(a.book) - order.indexOf(b.book));
  return { sections, items, warnings };
}

function parseItems(rows: unknown[][], warnings: string[]): StmtItem[] {
  const h = findHeader(rows, ["urun", "cari"]);
  if (!h || h.cols.item === undefined) { warnings.push("Malzeme kartları sayfasında başlık bulunamadı."); return []; }
  const c = h.cols;
  // aynı ürün iki caride de alınmışsa son alışın carisi geçerli (kural sonradan değişmiş olabilir)
  const byName = new Map<string, StmtItem>();
  for (let i = h.at + 1; i < rows.length; i++) {
    const r = rows[i] ?? [];
    const name = String(r[c.item!] ?? "").trim();
    if (!name) continue;
    const cari = norm(c.cari !== undefined ? r[c.cari] : "");
    const it: StmtItem = {
      supplier_name: name,
      unit: c.unit !== undefined ? String(r[c.unit] ?? "").trim() || null : null,
      route: /pesin|iskontosuz/.test(cari) ? "nodisc" : "slip",
      price: c.last_price !== undefined ? cellCents(r[c.last_price]) || null : null,
      currency: "EUR",
      price_date: c.last_date !== undefined ? cellDate(r[c.last_date]) : null,
    };
    const key = name.toLocaleLowerCase("tr-TR");
    const prev = byName.get(key);
    if (!prev || (it.price_date ?? "") > (prev.price_date ?? "")) byName.set(key, it);
  }
  const out = [...byName.values()];
  return out;
}

/** Bölümün kapanış bakiyesi (borç − alacak, devir dahil): pozitif = borcumuz */
export const sectionClosing = (s: StmtSection) => s.opening + s.debit - s.credit;
