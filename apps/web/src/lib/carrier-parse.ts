import "server-only";

import * as XLSX from "xlsx";

/** DHL / UPS kargo faturası okuyucuları. Tutarlar kuruş (tam sayı). */
export type CarrierItem = { awb: string; ship_date: string | null; origin?: string | null; dest?: string | null; dest_country?: string | null; product?: string | null;
  weight: number | null; weight_basis?: string | null; base_amount: number; extras: { name: string; amount: number }[]; total: number;
  src_currency?: string | null; src_amount?: number | null; recipient?: string | null; recipient_company?: string | null; address?: string | null };
export type CarrierInvoice = { carrier: "dhl" | "ups"; invoice_no: string; ettn: string | null; invoice_date: string | null; due_date: string | null; bill_type: string | null;
  account_no: string | null; total: number; vat_total: number; eur_total: number | null; eur_rate: number | null; items: CarrierItem[] };

type Tok = { x: number; s: string };
const trNum = (s: string) => Math.round(Number(s.replace(/\./g, "").replace(",", ".")) * 100);
const isMoney = (s: string) => /^-?\d{1,3}(\.\d{3})*,\d{2}$/.test(s);
const dmy = (s: string | undefined | null) => { const m = (s ?? "").match(/(\d{1,2})[-./](\d{1,2})[-./](\d{4})/); return m ? `${m[3]}-${m[2]!.padStart(2, "0")}-${m[1]!.padStart(2, "0")}` : null; };

/** PDF → satırlar (her satır x'e göre sıralı metin parçaları) */
export async function pdfLines(buf: Uint8Array): Promise<Tok[][]> {
  const { getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(buf);
  const out: Tok[][] = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const tc = await (await pdf.getPage(p)).getTextContent();
    const rows: { y: number; t: Tok[] }[] = [];
    for (const it of tc.items as { str?: string; transform: number[] }[]) {
      const s = (it.str ?? "").trim();
      if (!s) continue;
      const y = it.transform[5]!;
      let row = rows.find((r) => Math.abs(r.y - y) <= 2);
      if (!row) { row = { y, t: [] }; rows.push(row); }
      row.t.push({ x: it.transform[4]!, s });
    }
    rows.sort((a, b) => b.y - a.y).forEach((r) => out.push(r.t.sort((a, b) => a.x - b.x)));
  }
  return out;
}

const text = (t: Tok[]) => t.map((x) => x.s).join(" ");
const after = (lines: Tok[][], label: RegExp) => {
  for (const l of lines) {
    const i = l.findIndex((t) => label.test(t.s));
    if (i >= 0 && l[i + 1]) return l[i + 1]!.s;
  }
  return null;
};

export function parseDhl(lines: Tok[][]): CarrierInvoice {
  const all = lines.map(text).join("\n");
  const inv: CarrierInvoice = {
    carrier: "dhl", invoice_no: (after(lines, /^Fatura No:?$/) ?? "").replace(/\s/g, ""), ettn: all.match(/ETTN:\s*([0-9a-f-]{36})/i)?.[1] ?? null,
    invoice_date: dmy(after(lines, /^Fatura Tarihi:?$/)), due_date: dmy(after(lines, /^Son Ödeme Tarihi:?$/)),
    bill_type: /Alıcı Ödemeli/i.test(all) ? "Alıcı ödemeli" : /Gönderici Ödemeli/i.test(all) ? "Gönderici ödemeli" : /3\.?\s*Şahıs/i.test(all) ? "3. şahıs ödemeli" : null,
    account_no: after(lines, /^Abone No:?$/), total: 0, vat_total: 0, eur_total: null, eur_rate: null, items: [],
  };
  const g = all.match(/GENEL TOPLAM\s*:\s*([\d.,]+)\s*TRY/); if (g) inv.total = trNum(g[1]!);
  const k = all.match(/TOPLAM KDV\s*:\s*([\d.,]+)/); if (k) inv.vat_total = trNum(k[1]!);
  const e = all.match(/GENEL TOPLAM \(EUR\)\s*:\s*([\d.,]+)/); if (e) inv.eur_total = trNum(e[1]!);
  const r = all.match(/EUR\/TL KURU\s*:\s*([\d.,]+)/); if (r) inv.eur_rate = Number(r[1]!.replace(",", "."));
  let cur: CarrierItem | null = null;
  let pending = "";
  let addrOpen = false;
  const close = () => { if (cur) { cur.total = cur.base_amount + cur.extras.reduce((a, x) => a + x.amount, 0); inv.items.push(cur); } cur = null; pending = ""; addrOpen = false; };
  for (const l of lines) {
    const t0 = l[0]?.s ?? "";
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(t0) && /^[0-9A-Z]{8,14}$/.test(l[1]?.s ?? "")) {
      close();
      const money = l.filter((t) => isMoney(t.s));
      const wIdx = l.findIndex((t) => /^\d+,\d{2}$/.test(t.s) && t.x < 370);
      cur = { awb: l[1]!.s, ship_date: dmy(t0), origin: l[2]?.s ?? null, dest: l[3]?.s ?? null, product: l[4]?.s ?? null,
        weight: wIdx >= 0 ? Number(l[wIdx]!.s.replace(",", ".")) : null, weight_basis: wIdx >= 0 && /^[AVBWM]$/.test(l[wIdx + 1]?.s ?? "") ? l[wIdx + 1]!.s : null,
        base_amount: money.length ? trNum(money[money.length - 1]!.s) : 0, extras: [], total: 0 };
      continue;
    }
    if (!cur) continue;
    if (/^TARİH$/.test(t0) || /NET TOPLAM/.test(text(l))) { if (/NET TOPLAM/.test(text(l))) close(); continue; }
    if (/^GÖNDERİCİ REF/.test(t0) || /^GÖNDERİCİ :?$/.test(t0) || /^GÖNDERİCİ FİRMA/.test(t0)) {
      const ai = l.findIndex((t) => /^ALICI( FİRMA)? ?:?$/.test(t.s) || /^ALICI:$/.test(t.s));
      if (ai >= 0) { const v = l.slice(ai + 1).map((t) => t.s).join(" ").trim(); if (/FİRMA/.test(l[ai]!.s)) cur.recipient_company = v; else cur.recipient = v; }
      pending = ""; continue;
    }
    if (/^GÖNDERİCİ ADRES/.test(t0)) {
      const ai = l.findIndex((t) => /^ALICI ADRES/.test(t.s));
      if (ai >= 0) { cur.address = l.slice(ai + 1).map((t) => t.s).join(" "); addrOpen = true; }
      continue;
    }
    if (addrOpen) {
      const rest = l.filter((t) => t.x >= 300).map((t) => t.s);
      if (rest.length) { cur.address = `${cur.address ?? ""} ${rest.join(" ")}`.trim(); const cc = rest[rest.length - 1]!; if (/^[A-Z]{2}$/.test(cc)) cur.dest_country = cc; }
      addrOpen = false; continue;
    }
    const words = l.filter((t) => !isMoney(t.s) && t.x < 370).map((t) => t.s).join(" ").trim();
    const money = l.filter((t) => isMoney(t.s));
    if (money.length) {
      const name = `${pending} ${words}`.trim() || "Ek ücret";
      cur.extras.push({ name, amount: trNum(money[money.length - 1]!.s) });
      pending = "";
    } else if (words) {
      // "GOGREEN PLUS - CARBON" (tutar alt satırda) / "REDUCED" (ad devamı)
      if (!pending && cur.extras.length && /^[A-Z ]+$/.test(words) && words.split(" ").length === 1) cur.extras[cur.extras.length - 1]!.name += ` ${words}`;
      else pending = `${pending} ${words}`.trim();
    }
  }
  close();
  if (!inv.items.length && !inv.invoice_no) throw new Error("DHL faturası okunamadı.");
  return inv;
}

export function parseUpsPdf(lines: Tok[][]): CarrierInvoice {
  const all = lines.map(text).join("\n");
  const no = all.match(/Fatura No:\s*([A-Z0-9]{10,20})/)?.[1] ?? "";
  if (!no) throw new Error("UPS faturası okunamadı.");
  const tot = all.match(/Ödenecek Tutar\s*([\d.,]+)\s*TL/);
  const vat = all.match(/Hesaplanan Kdv Vergisi[^\d]*([\d.,]+)\s*TL/);
  const eur = all.match(/1 EUR:\s*([\d.,]+)/);
  return { carrier: "ups", invoice_no: no, ettn: all.match(/ETTN:\s*([0-9a-f-]{36})/i)?.[1] ?? null, invoice_date: dmy(all.match(/Fatura Tarihi:\s*([\d-./]+)/)?.[1]),
    due_date: null, bill_type: all.match(/Hizmet Türü:\s*([A-ZÇĞİÖŞÜ]+)/)?.[1] ?? null, account_no: all.match(/\b([0-9A-Z]{6})\s*-\s*MB DIS/)?.[1] ?? null,
    total: tot ? trNum(tot[1]!) : 0, vat_total: vat ? trNum(vat[1]!) : 0, eur_total: null, eur_rate: eur ? Number(eur[1]!) : null, items: [] };
}

/** UPS "Fatura Detay" Excel: her satır bir konşimentonun bir ücret kalemi */
export function parseUpsDetail(buf: Buffer | Uint8Array): CarrierInvoice {
  const wb = XLSX.read(buf, { type: "buffer", cellDates: true });
  const t = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]!]!, { header: 1, raw: true, defval: "" });
  const S = (v: unknown) => String(v ?? "").trim();
  const no = t.slice(0, 3).flat().map(S).join(" ").match(/(UP[A-Z]?\d{10,16})/)?.[1] ?? "";
  const hi = t.findIndex((r) => r.map(S).includes("Waybill"));
  if (hi < 0 || !no) throw new Error("UPS fatura detay dosyası okunamadı ('Waybill' sütunu ya da fatura no yok).");
  const h = t[hi]!.map(S);
  const c = (n: string) => h.indexOf(n);
  const C = { awb: c("Waybill"), desc: c("Açıklama"), w: c("Geçerli Ağırlık"), d: c("Export Tarihi"), rcv: c("Alıcı"), cty: c("Ülke"), amt: c("Tutar"), cur: c("Para Birimi"), inv: c("Fatura Tutarı") };
  const map = new Map<string, CarrierItem>();
  const num = (v: unknown) => (typeof v === "number" ? v : Number(S(v).replace(/\./g, "").replace(",", ".")) || 0);
  const day = (v: unknown) => (v instanceof Date ? new Date(v.getTime() - v.getTimezoneOffset() * 60000).toISOString().slice(0, 10) : dmy(S(v)));
  for (const r of t.slice(hi + 1)) {
    const awb = S(r[C.awb]).replace(/\s/g, "").toUpperCase();
    if (!/^[0-9A-Z]{8,}$/.test(awb) || !/\d/.test(awb)) continue;   // "Genel Toplam" vb.
    let it = map.get(awb);
    if (!it) {
      it = { awb, ship_date: day(r[C.d]), dest_country: S(r[C.cty]) || null, weight: num(r[C.w]) || null, base_amount: 0, extras: [], total: 0,
        recipient_company: S(r[C.rcv]) || null, src_currency: S(r[C.cur]) || null, src_amount: 0 };
      map.set(awb, it);
    }
    const desc = S(r[C.desc]);
    const amt = Math.round(num(r[C.inv]) * 100);
    if (/^navlun$/i.test(desc)) it.base_amount += amt; else it.extras.push({ name: desc, amount: amt });
    it.total += amt;
    it.src_amount = (it.src_amount ?? 0) + Math.round(num(r[C.amt]) * 100);
  }
  const items = [...map.values()];
  return { carrier: "ups", invoice_no: no, ettn: null, invoice_date: null, due_date: null, bill_type: null, account_no: null,
    total: items.reduce((a, x) => a + x.total, 0), vat_total: 0, eur_total: null, eur_rate: null, items };
}

/** Dosya türüne göre oku */
export async function parseCarrierFile(name: string, buf: Uint8Array): Promise<CarrierInvoice> {
  if (/\.xlsx?$/i.test(name)) return parseUpsDetail(buf);
  const lines = await pdfLines(buf);
  const head = lines.slice(0, 40).map(text).join(" ");
  if (/DHL/i.test(head)) return parseDhl(lines);
  if (/UPS/i.test(head)) return parseUpsPdf(lines);
  throw new Error("Dosya DHL ya da UPS faturası olarak tanınmadı.");
}
