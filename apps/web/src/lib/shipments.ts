/** Kargo, gümrük ve kurye takibi: ortak tipler ve etiketler */

export type Direction = "in" | "out";
export type Carrier = "dhl" | "ups" | "customs" | "our_courier" | "client_courier" | "post" | "other";
export type ShipStatus =
  | "expected"
  | "in_transit"
  | "at_customs"
  | "out_for_delivery"
  | "arrived"
  | "opened"
  | "job_created"
  | "ready"
  | "delivered"
  | "returned"
  | "cancelled";

export type Shipment = {
  id: string;
  no: number;
  direction: Direction;
  carrier: Carrier;
  status: ShipStatus;
  tracking_no: string | null;
  portal_account_id: string | null;
  portal_case_id: string | null;
  party_name: string | null;
  country: string | null;
  city: string | null;
  address: string | null;
  phone: string | null;
  package_count: number;
  contents: string[];
  expected_on: string | null;
  courier_date: string | null;
  courier_slot: string | null;
  arrived_at: string | null;
  opened_at: string | null;
  delivered_at: string | null;
  customs_broker: string | null;
  customs_ref: string | null;
  customs_cost: number | null;
  customs_currency: string;
  note: string | null;
  created_at: string;
  updated_at: string;
};

export const CARRIER: Record<Carrier, string> = {
  dhl: "DHL",
  ups: "UPS",
  customs: "Gümrük",
  our_courier: "Bizim kurye",
  client_courier: "Hekimin kuryesi",
  post: "Posta / PTT",
  other: "Diğer",
};

/** Durum: etiket ve rozet rengi */
export const STATUS: Record<ShipStatus, [string, string]> = {
  expected: ["Bekleniyor", "bg-[#EEF2F6] text-ink"],
  in_transit: ["Yolda", "bg-[#EAF2FB] text-brand-700"],
  at_customs: ["Gümrükte", "bg-warn-bg text-warn"],
  out_for_delivery: ["Dağıtımda", "bg-[#EAF2FB] text-brand-700"],
  arrived: ["Geldi", "bg-ok-bg text-ok"],
  opened: ["Açıldı", "bg-ok-bg text-ok"],
  job_created: ["İş kaydı açıldı", "bg-ok-bg text-ok"],
  ready: ["Sevke hazır", "bg-warn-bg text-warn"],
  delivered: ["Teslim edildi", "bg-ok-bg text-ok"],
  returned: ["İade", "bg-bad-bg text-bad"],
  cancelled: ["İptal", "bg-[#EEF2F6] text-muted"],
};

/** Yöne göre sıradaki adımlar (detay ekranındaki butonlar) */
export const FLOW: Record<Direction, ShipStatus[]> = {
  in: ["expected", "in_transit", "at_customs", "out_for_delivery", "arrived", "opened", "job_created"],
  out: ["ready", "in_transit", "at_customs", "out_for_delivery", "delivered"],
};

export const CONTENTS: Record<string, string> = {
  olcu: "Ölçü",
  model: "Model / alçı",
  artikulator: "Artikülatör",
  kayit: "Kapanış kaydı",
  eski_protez: "Eski protez",
  tasarim: "Dijital dosya (USB)",
  is: "Biten iş",
  belge: "Belge / reçete",
  diger: "Diğer",
};

export const SLOT: Record<string, string> = { morning: "Sabah", afternoon: "Öğleden sonra", any: "Gün içinde" };

/** Açık (bitmemiş) durumlar */
export const OPEN_IN: ShipStatus[] = ["expected", "in_transit", "at_customs", "out_for_delivery", "arrived", "opened"];
export const OPEN_OUT: ShipStatus[] = ["ready", "in_transit", "at_customs", "out_for_delivery"];

/** Kargo firmasının takip sayfası (otomatik takip anahtarları gelene kadar) */
export function trackingUrl(carrier: Carrier, no: string | null): string | null {
  if (!no) return null;
  const n = encodeURIComponent(no);
  if (carrier === "dhl") return `https://www.dhl.com/tr-tr/home/tracking/tracking-express.html?submit=1&tracking-id=${n}`;
  if (carrier === "ups") return `https://www.ups.com/track?loc=tr_TR&tracknum=${n}`;
  if (carrier === "post") return `https://gonderitakip.ptt.gov.tr/Track/Verify?q=${n}`;
  return null;
}

/** Takip numarası karşılaştırması için sadeleştirme */
export const normTracking = (s: string) => s.replace(/\s+/g, "").toUpperCase();

/** "2026-10-11T08:30" → "11.10.2026 11:30" (İstanbul) */
export function fmtDateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("tr-TR", { timeZone: "Europe/Istanbul", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** Kaç gündür bu durumda (gecikme göstergesi) */
export function daysSince(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
}

export const LOGISTICS_ROLES = ["owner", "accountant", "hr", "branch_manager"];
