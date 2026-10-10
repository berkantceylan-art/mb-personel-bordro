/** Laboratuvar iş kaydı: ortak tipler, etiketler, renkler */

export type Customer = {
  id: string;
  name: string;
  kind: string;
  portal_account_id: string | null;
  currency: "TRY" | "EUR" | "USD";
  phone: string | null;
  email: string | null;
  country: string;
  city: string | null;
  address: string | null;
  tax_office: string | null;
  tax_no: string | null;
  discount_pct: number;
  note: string | null;
  is_active: boolean;
};

export type Product = { id: string; code: string | null; name: string; material: string | null; price_try: number | null; price_eur: number | null; per_unit: boolean; sort: number; is_active: boolean };

export type JobItem = { id?: string; product_id: string | null; name: string; qty: number; unit_price: number; amount: number; kind: ItemKind };
export type JobStep = { id?: string; kind: string; out_date: string | null; back_date: string | null; delivery_method: string | null; delivery_time: string | null; done: boolean; note: string | null };

export type Job = {
  id: string;
  no: number;
  slip_no: string | null;
  customer_id: string | null;
  doctor_name: string | null;
  patient: string | null;
  shade: string | null;
  shade_cervical: string | null;
  shade_incisal: string | null;
  description: string | null;
  invoice_note: string | null;
  print_note: string | null;
  metal_band: "circumferential" | "yes" | "no" | null;
  received: string[];
  teeth: Record<string, string>;
  in_date: string;
  due_date: string | null;
  delivery_method: string | null;
  delivery_time: string | null;
  status: JobStatus;
  currency: "TRY" | "EUR" | "USD";
  total: number;
  shipment_id: string | null;
  portal_case_id: string | null;
  delivered_at: string | null;
  created_at: string;
};

export type JobStatus = "open" | "tryin" | "ready" | "delivered" | "cancelled";
export type ItemKind = "paid" | "rpt" | "repair" | "adjust" | "free";

export const JOB_STATUS: Record<JobStatus, [string, string]> = {
  open: ["Üretimde", "bg-[#EAF2FB] text-brand-700"],
  tryin: ["Provada", "bg-warn-bg text-warn"],
  ready: ["Hazır", "bg-ok-bg text-ok"],
  delivered: ["Teslim edildi", "bg-[#EEF2F6] text-ink"],
  cancelled: ["İptal", "bg-bad-bg text-bad"],
};

export const ITEM_KIND: Record<ItemKind, string> = { paid: "Ücretli", rpt: "Rpt", repair: "Tamir", adjust: "Düzeltme", free: "Ücretsiz" };
/** Ücret alınmayan satır türleri (tutar 0 sayılır) */
export const FREE_KINDS: ItemKind[] = ["free", "rpt", "adjust"];

export const RECEIVED: Record<string, string> = { isirik: "Isırık", model: "Model", olcu: "Ölçü", kasik: "Kaşık", mum: "Mum" };

export const METAL_BAND: Record<string, string> = { circumferential: "Çepeçevre metal bant", yes: "Metal bant var", no: "Metal bant yok" };

/** Diş şeması malzemeleri: anahtar → [etiket, renk] (DentalSIS renkleriyle uyumlu) */
export const MATERIALS: Record<string, [string, string]> = {
  porselen: ["Porselen", "#E7C500"],
  zirkon: ["Zirkon", "#E53935"],
  implant: ["İmplant", "#2E9E3E"],
  fulkron: ["Fulkron", "#8E9AA6"],
  emax: ["EMax", "#7B1FA2"],
  postcore: ["PostCore", "#1E40C8"],
  total: ["Total", "#F59E0B"],
  iskelet: ["İskelet", "#D81B9E"],
  kompozit: ["Kompozit", "#7CB342"],
  inlayonlay: ["InlayOnlay", "#29B6F6"],
  fulzirkon: ["Fulzirkon", "#C0A000"],
  gecici: ["Geçici", "#6D7A4E"],
};

/** FDI diş numaraları: üst çene sağ→sol, alt çene sağ→sol */
export const UPPER = [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28];
export const LOWER = [48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38];

export const CUSTOMER_KIND: Record<string, string> = { doctor_tr: "Yerli hekim", doctor_foreign: "Yabancı hekim", clinic: "Klinik", hospital: "Hastane", agency: "Aracı kuruluş" };

export const CUR_SYMBOL: Record<string, string> = { TRY: "₺", EUR: "€", USD: "$" };

/** 125050 → "1.250,50 ₺" */
export function money(minor: number | null | undefined, currency = "TRY"): string {
  const v = Number(minor ?? 0) / 100;
  return `${v.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${CUR_SYMBOL[currency] ?? currency}`;
}

/** "1.250,50" | "1250.5" → 125050 (kuruş); boş/geçersiz → null */
export function parseMoney(s: string): number | null {
  const t = s.trim();
  if (!t) return null;
  const norm = t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t;
  const n = Number(norm);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
}

/** Satır tutarı: ücretsiz türlerde 0 */
export const lineAmount = (qty: number, unit: number, kind: ItemKind) => (FREE_KINDS.includes(kind) ? 0 : qty * unit);

/** Diş şemasından malzemeye göre diş sayıları: { zirkon: 4, implant: 2 } */
export function teethByMaterial(teeth: Record<string, string>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const m of Object.values(teeth)) out[m] = (out[m] ?? 0) + 1;
  return out;
}

/** Sevkiyat içeriği → iş kaydındaki gelen malzeme */
export const SHIPMENT_TO_RECEIVED: Record<string, string> = { olcu: "olcu", model: "model", kayit: "isirik" };
