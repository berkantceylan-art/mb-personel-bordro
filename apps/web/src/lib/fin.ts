/** Finans modülleri: ortak tipler, etiketler, para biçimleri */

export const CURRENCIES = ["TRY", "EUR", "USD", "GBP", "CHF"] as const;
export type Currency = (typeof CURRENCIES)[number];
export const CUR_SYMBOL: Record<string, string> = { TRY: "₺", EUR: "€", USD: "$", GBP: "£", CHF: "CHF" };

/** 125050 → "1.250,50 ₺"; işaret korunur */
export function fmt(minor: number | string | null | undefined, currency = "TRY", opts: { sign?: boolean } = {}): string {
  const v = Number(minor ?? 0) / 100;
  const s = Math.abs(v).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const sign = v < 0 ? "−" : opts.sign && v > 0 ? "+" : "";
  return `${sign}${s} ${CUR_SYMBOL[currency] ?? currency}`;
}

/** "1.250,50" | "1250.5" | "-30" → 125050 (kuruş); boş/geçersiz → null. allowNegative değilse eksi kabul edilmez. */
export function parseAmount(s: string | null | undefined, allowNegative = false): number | null {
  const t = String(s ?? "").trim().replace(/\s|₺|€|\$|£/g, "");
  if (!t) return null;
  const neg = /^[-−]/.test(t);
  const body = t.replace(/^[-−+]/, "");
  const norm = body.includes(",") ? body.replace(/\./g, "").replace(",", ".") : /^\d{1,3}(\.\d{3})+$/.test(body) ? body.replace(/\./g, "") : body;
  const n = Number(norm);
  if (!Number.isFinite(n) || n < 0) return null;
  if (neg && !allowNegative) return null;
  return Math.round(n * 100) * (neg ? -1 : 1);
}

/** "37,5" → 37.5 */
export function parseRate(s: string | null | undefined): number | null {
  const t = String(s ?? "").trim().replace(",", ".");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export const ACCOUNT_KIND: Record<string, { label: string; plural: string; href: string; liability?: boolean }> = {
  cash: { label: "Kasa", plural: "Kasalar", href: "/finans/kasa" },
  bank: { label: "Banka hesabı", plural: "Banka hesapları", href: "/finans/banka" },
  pos: { label: "POS hesabı", plural: "POS hesapları", href: "/finans/banka" },
  credit_card: { label: "Kredi kartı", plural: "Kredi kartları", href: "/finans/kredi-karti", liability: true },
  loan: { label: "Kredi", plural: "Krediler", href: "/finans/krediler", liability: true },
  partner: { label: "Ortak hesabı", plural: "Ortak hesapları", href: "/finans/ortaklar" },
  advance: { label: "Avans hesabı", plural: "Avans hesapları", href: "/finans/avans" },
  cheque_in: { label: "Alınan çek / senet portföyü", plural: "Alınan çekler", href: "/finans/cek-senet" },
  cheque_out: { label: "Verilen çek / senet", plural: "Verilen çekler", href: "/finans/cek-senet" },
};

export const PARTY_KIND: Record<string, string> = { customer: "Müşteri", supplier: "Tedarikçi", both: "Müşteri + tedarikçi", other: "Diğer" };

export const TXN_KIND: Record<string, string> = {
  opening: "Açılış", collection: "Tahsilat", payment: "Ödeme", transfer: "Virman", income: "Gelir", expense: "Masraf", exchange: "Döviz alım / satım",
  sale_invoice: "Satış faturası", purchase_invoice: "Alış faturası", sale_return: "Satış iadesi", purchase_return: "Alış iadesi",
  cheque_in: "Çek / senet alındı", cheque_out: "Çek / senet verildi", cheque_endorse: "Çek ciro", cheque_collect: "Çek tahsil", cheque_bounce: "Karşılıksız", cheque_pay: "Çek ödendi", cheque_deposit: "Çek bankaya verildi",
  card_spend: "Kart harcaması", card_payment: "Kart borcu ödemesi", loan_draw: "Kredi kullanımı", loan_payment: "Kredi taksiti",
  advance_give: "Avans verildi", advance_close: "Avans kapama", advance_return: "Avans iadesi", partner_in: "Ortaktan giriş", partner_out: "Ortağa çıkış",
  credit_sale: "Veresiye satış", depreciation: "Amortisman", stock: "Stok", adjust: "Düzeltme",
};

export const CATEGORY_KIND: Record<string, string> = { income: "Gelir", expense: "Gider", vat_in: "İndirilecek KDV", vat_out: "Hesaplanan KDV", stock: "Stok / varlık", equity: "Özkaynak", other: "Diğer" };

export type Party = {
  id: string; code: string | null; name: string; kind: string; person_type: string; tax_office: string | null; tax_no: string | null;
  phone: string | null; email: string | null; website: string | null; contact_name: string | null; address: string | null; district: string | null; city: string | null; country: string;
  iban: string | null; currency: string; opening_balance: number; opening_date: string | null; payment_term_days: number; credit_limit: number | null;
  credit_sales: boolean; is_einvoice: boolean; einvoice_alias: string | null; lab_customer_id: string | null; note: string | null; is_active: boolean; source: string;
};

export type Account = {
  id: string; kind: string; name: string; currency: string; bank_name: string | null; branch: string | null; iban: string | null; account_no: string | null;
  card_last4: string | null; card_limit: number | null; statement_day: number | null; due_day: number | null; holder_employee_id: string | null; holder_name: string | null;
  share_pct: number | null; opening_balance: number; opening_date: string; is_active: boolean; sort: number; note: string | null;
};

export type Category = { id: string; code: string; name: string; kind: string; is_system: boolean; is_active: boolean; sort: number };

/** Supabase hatasını kullanıcı diline çevir */
export function finError(message: string): string {
  if (/not_allowed|permission|policy/i.test(message)) return "Bu işlem için yetkiniz yok (Yönetim > Yetkiler).";
  if (/rate_missing/.test(message)) return "Döviz kuru bulunamadı: Finans > Kurlar sayfasından kur girin ya da formda kuru yazın.";
  if (/unbalanced/.test(message)) return "Kayıt dengesiz (borç ve alacak eşit değil).";
  if (/use_invoice_cancel/.test(message)) return "Bu kayıt bir faturaya ait: faturayı açıp oradan iptal edin (stok ve KDV de geri alınır).";
  if (/fin_parties_tax_uidx|duplicate key.*tax/i.test(message)) return "Bu vergi / TC numarasıyla kayıtlı başka bir cari var.";
  if (/(fin_|fx_|module_)\w* .*does not exist|relation "(fin_|fx_|module_)|schema cache/i.test(message)) return "Finans tabloları yok: Supabase'de 20261202000000_finance_core.sql çalıştırılmalı.";
  return message;
}

/** Bugün (İstanbul) */
export const today = () => new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10);
export const dateOk = (v: string | null | undefined) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
