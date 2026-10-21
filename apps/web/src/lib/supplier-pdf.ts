import "server-only";



/**
 * Tedarikçi "Cari Hareket Dökümü" PDF'i (ExpressPrinting / Gözde Diş Deposu biçimi) → ekstre aktarımının beklediği sayfa satırları.
 * Sütunlar başlık satırından konumla bulunur: Tarih, Fiş No, Açıklama, Stok Adı, Miktar, Fiyat, Vade Tarihi, Borç Tut., Alac.Tut., Borç Bak., Alacak Bak.
 * Çıktı sayfa adı carinin türünü belirler: "Euro Cari" (iskontolu fişli), "İskontosuz Cari", "Resmi Cari", "KDV Cari"; ayrıca "Malzeme Kartları".
 */
type Tok = { x: number; w: number; s: string };
type Col = { key: string; x: number };
export type PdfBook = "slip" | "nodisc" | "main" | "vat";
export const PDF_SHEET: Record<PdfBook, string> = { slip: "Euro Cari", nodisc: "Peşin Cari (iskontosuz)", main: "Resmi Cari", vat: "KDV Cari" };

const HEAD: [RegExp, string][] = [
  [/^tarih$/i, "date"], [/^fi[sş] ?no$/i, "doc"], [/^a[cç][iı]klama$/i, "desc"], [/^stok ?ad[iı]$/i, "item"], [/^miktar$/i, "qty"],
  [/^fiyat$/i, "price"], [/^vade/i, "due"], [/^bor[cç] ?tut/i, "debit"], [/^alac?\.? ?tut/i, "credit"], [/^bor[cç] ?bak/i, "dbal"], [/^alacak ?bak/i, "cbal"],
];

async function pdfRows(buf: Uint8Array): Promise<Tok[][]> {
  const { getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(buf);
  const out: Tok[][] = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const tc = await (await pdf.getPage(p)).getTextContent();
    const rows: { y: number; t: Tok[] }[] = [];
    for (const it of tc.items as { str?: string; transform: number[]; width?: number }[]) {
      const s = it.str ?? "";
      if (!s.trim()) continue;
      const y = it.transform[5]!;
      let row = rows.find((r) => Math.abs(r.y - y) <= 2);
      if (!row) { row = { y, t: [] }; rows.push(row); }
      row.t.push({ x: it.transform[4]!, w: it.width ?? s.length * 4, s });
    }
    for (const r of rows.sort((a, b) => b.y - a.y)) out.push(r.t.sort((a, b) => a.x - b.x));
  }
  return out;
}

/** Bitişik parçaları (Türkçe harfler ayrı parça gelir) kelimeye birleştirir */
function join(t: Tok[]) {
  let o = "", end = -1e9;
  for (const k of t) { o += (o && k.x - end > 1.5 ? " " : "") + k.s; end = k.x + k.w; }
  return o.replace(/\s+/g, " ").trim();
}
const words = (r: Tok[]) => { const out: Tok[] = []; let end = -1e9; for (const k of r) { if (out.length && k.x - end <= 1.5) { const l = out[out.length - 1]!; l.s += k.s; l.w = k.x + k.w - l.x; } else out.push({ ...k }); end = k.x + k.w; } return out; };

export type PdfSheet = { book: PdfBook; title: string; rows: unknown[][]; items: { name: string; unit: string | null; price: number; date: string }[]; closing: number | null };

export async function parseSupplierPdf(buf: Uint8Array, fileName = ""): Promise<PdfSheet> {
  const rows = await pdfRows(buf);
  const text = rows.map(join);
  if (!text.some((l) => /cari hareket d[öo]k[üu]m[üu]/i.test(l))) throw new Error("\"Cari Hareket Dökümü\" PDF'i değil.");
  const titleLine = text.find((l) => /^cari kod/i.test(l)) ?? "";
  const title = titleLine.replace(/^cari kod\s*/i, "").trim();
  let cols: Col[] | null = null;
  let book: PdfBook | null = null;
  const out: unknown[][] = [["Tarih", "Belge", "Açıklama", "Ürün", "Miktar", "Birim", "Liste Fiyatı", "Borç", "Alacak"]];
  const items: PdfSheet["items"] = [];
  let lastDate = "", seq = 0, closing: number | null = null;
  const dmy = (s: string) => s.split(".").reverse().join("-");
  for (const r of rows) {
    const ws = words(r);
    // başlık satırı (her sayfada tekrar edebilir)
    const hc: Col[] = [];
    for (const w of ws) { const h = HEAD.find(([re]) => re.test(w.s.trim())); if (h) hc.push({ key: h[1], x: w.x }); }
    if (hc.some((c) => c.key === "date") && hc.some((c) => c.key === "debit")) {
      cols = hc.sort((a, b) => a.x - b.x);
      if (!book) {
        const t = `${title} ${fileName}`.toLocaleUpperCase("tr");
        book = /[İI]SKONTOSUZ/.test(t) ? "nodisc" : cols.some((c) => c.key === "item") ? "slip" : /KDV/.test(t) || !text.some((l) => /V\.No|A\.Ş|A\.S\./i.test(l)) ? "vat" : "main";
      }
      continue;
    }
    if (!cols) continue;
    // sütuna ata: başlığın 12 pt solundan bir sonraki sütuna kadar
    const bounds = cols.map((c, i) => Math.max(c.x - 12, i ? cols![i - 1]!.x + 1 : -1e9));
    const g: Record<string, Tok[]> = {};
    for (const k of r) {
      let i = bounds.length - 1;
      while (i > 0 && k.x < bounds[i]!) i--;
      (g[cols[i]!.key] ??= []).push(k);
    }
    const v = (key: string) => (g[key] ? join(g[key]!) : "");
    const all = join(r);
    if (/genel toplam|^toplam/i.test(all) || /toplam/i.test(v("due") + v("price"))) {
      const nums = all.match(/[\d.]+,\d{2}/g) ?? [];
      if (/genel toplam/i.test(all) && nums.length >= 2) {
        const n = nums.map((x) => Number(x.replace(/\./g, "").replace(",", ".")));
        closing = Math.round((n[0]! - n[1]!) * 100);
      }
      continue;
    }
    // tarih ve fiş no aynı parçada gelebilir ("05.01.20261693")
    let date = v("date"), doc = v("doc");
    const m = date.match(/^(\d{2}\.\d{2}\.\d{4})\s*(.*)$/);
    if (m) { date = m[1]!; if (m[2]) doc = (m[2] + " " + doc).trim(); } else date = "";
    const debit = v("debit"), credit = v("credit"), item = v("item");
    let desc = v("desc");
    if (/cari hareket d|^cari kod|^tel\s*:|v\.no:/i.test(all)) continue;
    if (!debit && !credit) continue;   // sayfa başlığı, adres vb.
    if (/^devreden$/i.test(desc) && !date) continue;
    if (date) {
      // fiş numarası yoksa aynı gündeki ayrı fişler karışmasın diye sıra no
      if (date !== lastDate) { lastDate = date; seq = 0; }
      seq++;
      if (!doc) doc = `#${seq}`;
    }
    const q = v("qty").match(/^([\d.,]+)\s*-?\s*(\S*)$/);
    const qty = q ? Number(q[1]!.replace(/\./g, "").replace(",", ".")) : "";
    const unit = q?.[2] || "";
    if (item && !desc && !date) desc = "";
    out.push([date, date ? doc : "", desc, item, qty, unit, v("price"), debit, credit]);
    if (item && lastDate) {
      const p = Math.round(Number(v("price").replace(/\./g, "").replace(",", ".") || 0) * 100);
      items.push({ name: item, unit: unit || null, price: p, date: dmy(lastDate) });
    }
  }
  if (!cols || !book) throw new Error("Ekstrenin başlık satırı (Tarih, Borç Tut., Alac.Tut.) bulunamadı.");
  return { book, title, rows: out, items, closing };
}

/** Birden fazla PDF → parseStatementWorkbook'a verilecek sayfalar (+ Malzeme Kartları) */
export function pdfSheetsToWorkbook(list: PdfSheet[]) {
  const sheets: Record<string, unknown[][]> = {};
  const items = new Map<string, { name: string; cari: string; unit: string | null; price: number; date: string }>();
  for (const s of list) {
    let name = PDF_SHEET[s.book];
    while (sheets[name]) name += " ·";
    sheets[name] = s.rows;
    if (s.book === "slip" || s.book === "nodisc") for (const it of s.items) {
      const k = it.name.toLocaleLowerCase("tr");
      const prev = items.get(k);
      if (!prev || it.date >= prev.date) items.set(k, { ...it, cari: s.book === "nodisc" ? "İskontosuz" : "Euro" });
    }
  }
  if (items.size) sheets["Malzeme Kartları"] = [["Ürün", "Cari", "Birim", "Son Liste Fiyatı", "Son Alış"], ...[...items.values()].map((i) => [i.name, i.cari, i.unit ?? "", (i.price / 100).toFixed(2).replace(".", ","), i.date.split("-").reverse().join(".")])];
  return sheets;
}
