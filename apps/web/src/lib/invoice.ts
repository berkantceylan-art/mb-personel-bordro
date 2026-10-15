/** Alış / satış faturaları: etiketler, satır hesabı (veritabanıyla aynı), tipler */
import { EINV_PROFILES, EINV_SEND_STATUS, EXEMPTIONS } from "@/lib/einv-codes";

export const INV_STATUS: Record<string, [string, "gray" | "green" | "red"]> = { draft: ["Taslak", "gray"], posted: ["Kesildi / işlendi", "green"], cancelled: ["İptal", "red"] };
export const EINV_STATUS = EINV_SEND_STATUS;
export const PROFILES: Record<string, string> = Object.fromEntries(Object.entries(EINV_PROFILES).map(([k, v]) => [k, v.label]));
export const VAT_RATES = [0, 1, 10, 20];
/** KDV istisna kodları (%0 satırlar) */
export const VAT_EXEMPTIONS: [string, string][] = EXEMPTIONS;
export const DIRECTION = {
  sale: { label: "Satış", plural: "Satış faturaları", base: "/satis", party: "Müşteri", module: "sales" as const },
  purchase: { label: "Alış", plural: "Alış faturaları", base: "/alis", party: "Tedarikçi", module: "purchases" as const },
};
export type Direction = keyof typeof DIRECTION;

export type LineInput = {
  item_id?: string | null; lab_product_id?: string | null; category_id?: string | null; job_id?: string | null;
  name: string; seller_code?: string | null; qty: number; unit: string; unit_price: number; discount_pct: number; vat_rate: number;
  withholding_rate?: number; withholding_code?: string | null; vat_exemption_code?: string | null; lot_no?: string | null; expiry_date?: string | null;
  gtip?: string | null; ident_scheme?: string | null; ident?: string | null; diib_line?: string | null;
};

/** inv_save ile aynı yuvarlama: tutarlar kuruş */
export function calcLine(l: Pick<LineInput, "qty" | "unit_price" | "discount_pct" | "vat_rate" | "withholding_rate">) {
  const qty = Math.max(0, Number(l.qty) || 0);
  const price = Math.max(0, Number(l.unit_price) || 0);
  const disc = Math.min(100, Math.max(0, Number(l.discount_pct) || 0));
  const vr = Math.min(100, Math.max(0, Number(l.vat_rate) || 0));
  const wr = Math.min(100, Math.max(0, Number(l.withholding_rate) || 0));
  const gross = Math.round(qty * price * 100);
  const net = Math.round((gross * (100 - disc)) / 100);
  const vat = Math.round((net * vr) / 100);
  const withholding = Math.round((vat * wr) / 100);
  return { gross, discount: gross - net, net, vat, withholding, total: net + vat };
}

export function calcTotals(lines: Parameters<typeof calcLine>[0][]) {
  const t = { gross: 0, discount: 0, net: 0, vat: 0, withholding: 0, total: 0, byRate: new Map<number, { base: number; vat: number }>() };
  for (const l of lines) {
    const c = calcLine(l);
    t.gross += c.gross; t.discount += c.discount; t.net += c.net; t.vat += c.vat; t.withholding += c.withholding;
    const r = Number(l.vat_rate) || 0;
    const b = t.byRate.get(r) ?? { base: 0, vat: 0 };
    t.byRate.set(r, { base: b.base + c.net, vat: b.vat + c.vat });
  }
  t.total = t.net + t.vat - t.withholding;
  return t;
}

export type Invoice = {
  id: string; no: number; direction: Direction; type: "invoice" | "return"; status: string; doc_no: string | null; ettn: string; profile: string;
  invoice_date: string; invoice_time: string | null; due_date: string | null; party_id: string;
  party_name: string | null; party_tax_no: string | null; party_tax_office: string | null; party_address: string | null; party_district: string | null; party_city: string | null; party_country: string | null; party_email: string | null;
  currency: string; rate: number; warehouse_id: string | null; gross_total: number; discount_total: number; subtotal: number; vat_total: number; withholding_total: number; total: number;
  affects_balance: boolean; job_ids: string[]; return_of: string | null; einvoice_status: string; einvoice_note: string | null; source: string; fin_txn_id: string | null; note: string | null;
  created_at: string; posted_at: string | null; cancelled_at: string | null; cancel_reason: string | null;
} & Partial<EdocFields>;

/** e-Belge alanları (senaryo / tip, ihracat, kamu, e-arşiv, gönderim) */
export type EdocFields = {
  type_code: string | null; send_method: string; incoterm: string | null; transport_mode: number | null; package_kind: string | null; package_no: string | null; package_count: number | null;
  delivery_address: string | null; buyer_name: string | null; buyer_tax_no: string | null; online_sale: boolean; pay_method: string | null; pay_agent: string | null; pay_date: string | null;
  ship_date: string | null; carrier_tax_no: string | null; carrier_name: string | null; export_doc_kind: string | null; export_doc_no: string | null; export_doc_date: string | null;
  einv_alias: string | null; einv_draft: boolean | null; einv_sent_at: string | null; einv_ref: number | null; einv_code: number | null; einv_desc: string | null; einv_checked_at: string | null;
};
export type InvLine = LineInput & { id: string; sort: number; gross: number; discount: number; net: number; vat: number; withholding: number; total: number };

export type Company = {
  id: string; name: string; address: string | null; district: string | null; city: string | null; postal_code: string | null; country: string | null; phone: string | null; email: string | null;
  website: string | null; tax_office: string | null; tax_no: string | null; mersis_no: string | null; trade_registry_no: string | null;
  inv_prefix_efatura: string; inv_prefix_earsiv: string; inv_lab_vat: number; inv_note: string | null; einvoice_provider: string | null;
  einv_numbering?: "erp" | "elogo"; einv_draft?: boolean; einv_xslt_efatura?: string | null; einv_xslt_earsiv?: string | null; einv_xslt_irsaliye?: string | null;
  inv_prefix_irsaliye?: string; einv_iban?: string | null; einv_web?: string | null;
};

export function invError(message: string): string {
  if (/not_allowed|permission|policy/i.test(message)) return "Bu işlem için yetkiniz yok (Yönetim > Yetkiler: Satış / Alış).";
  if (/insufficient:(.+)/.test(message)) return `Depoda yeterli stok yok: ${message.match(/insufficient:([^"]+)/)?.[1]}. Önce alış faturası ya da açılış stoğu girin, veya başka depo seçin.`;
  if (/rate_missing:(\w+)/.test(message)) return `${message.match(/rate_missing:(\w+)/)?.[1]} kuru yok: Finans > Kurlar'dan kur çekin ya da formda kuru yazın.`;
  if (/einv_locked|einv_already/.test(message)) return "Bu belge eLogo'ya gönderildi ya da gönderiliyor; artık değiştirilemez.";
  if (/einv_not_posted/.test(message)) return "Önce faturayı kesin (işleyin), sonra gönderin.";
  if (/einv_not_sendable/.test(message)) return "Bu fatura elektronik gönderilmez (kâğıt fatura, e-faturadan alınmış ya da karşı tarafın keseceği belge).";
  if (/einvoice_sent/.test(message)) return "Gönderilmiş e-fatura iptal edilemez; iade faturası kesin (ya da alıcı GİB portalından reddetmeli).";
  if (/inv_invoices_sale_no_uidx/.test(message)) return "Bu fatura numarası başka bir satış faturasında kullanılmış.";
  if (/inv_invoices_purchase_no_uidx|inv_invoices_ettn_uidx/.test(message)) return "Bu fatura daha önce kaydedilmiş (aynı numara / ETTN).";
  if (/jobs_already_invoiced/.test(message)) return "Bu faturadaki işlerden biri başka bir faturaya bağlanmış ya da iptal edilmiş; taslağı silip işlerden yeniden oluşturun.";
  if (/jobs_mixed_customer/.test(message)) return "Seçilen işler farklı hekimlere ait; tek faturada aynı hekimin işleri olmalı.";
  if (/jobs_mixed_currency/.test(message)) return "Seçilen işler farklı para birimlerinde.";
  if (/jobs_required|jobs_empty/.test(message)) return "Faturalanacak iş yok: seçilen işler zaten faturalanmış, bir taslak faturada ya da tutarsız.";
  if (/party_required/.test(message)) return "Cari seçin.";
  if (/party_name_required/.test(message)) return "Cari adı yok.";
  if (/lines_required|empty_invoice/.test(message)) return "En az bir tutarlı satır girin.";
  if (/bad_status/.test(message)) return "Faturanın durumu bu işleme uygun değil.";
  if (/(inv_)\w* .*does not exist|relation "inv_|schema cache|function inv_/i.test(message)) return "Fatura tabloları yok: Supabase'de 20261204000000_invoices.sql çalıştırılmalı.";
  return message;
}

/** UBL birim kodları (UN/ECE Rec 20) */
export const UNIT_CODE: Record<string, string> = {
  adet: "C62", kutu: "BX", paket: "PA", gr: "GRM", kg: "KGM", ml: "MLT", lt: "LTR", m: "MTR", cm: "CMT", disk: "C62", blok: "C62", "takım": "SET", "çift": "PR", "diş": "C62", rulo: "C62", "şişe": "C62", "tüp": "C62", saat: "HUR",
};
export const CODE_UNIT: Record<string, string> = { C62: "adet", NIU: "adet", EA: "adet", BX: "kutu", PA: "paket", PK: "paket", GRM: "gr", KGM: "kg", MLT: "ml", LTR: "lt", MTR: "m", CMT: "cm", SET: "takım", PR: "çift", HUR: "saat", DAY: "gün", MON: "ay" };
