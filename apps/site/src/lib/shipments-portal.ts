// Portal "Paketlerim": tipler ve üç dilde metinler (istemci ve sunucu)
import type { Locale } from "./i18n";

export type PortalShipment = {
  id: string;
  no: number;
  direction: "in" | "out";
  carrier: string;
  status: string;
  tracking_no: string | null;
  package_count: number;
  courier_date: string | null;
  courier_slot: string | null;
  portal_case_id: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
};

export function shipTrackingUrl(carrier: string, no: string | null): string | null {
  if (!no) return null;
  const n = encodeURIComponent(no);
  if (carrier === "dhl") return `https://www.dhl.com/global-en/home/tracking/tracking-express.html?submit=1&tracking-id=${n}`;
  if (carrier === "ups") return `https://www.ups.com/track?tracknum=${n}`;
  return null;
}

type T = {
  nav: string;
  title: string;
  lead: string;
  sentTitle: string;
  sentLead: string;
  carrier: string;
  carriers: Record<string, string>;
  tracking: string;
  trackingHint: string;
  count: string;
  case: string;
  none: string;
  note: string;
  send: string;
  courierTitle: string;
  courierLead: string;
  date: string;
  slot: string;
  slots: Record<string, string>;
  address: string;
  requestCourier: string;
  list: string;
  incoming: string;
  outgoing: string;
  empty: string;
  status: Record<string, string>;
  ok: string;
  okCourier: string;
  errors: Record<string, string>;
};

export const SHIP_UI: Record<Locale, T> = {
  tr: {
    nav: "Paketlerim",
    title: "Paketlerim",
    lead: "Bize gönderdiğiniz ölçüler ve size gönderdiğimiz işler: nerede olduğunu buradan izleyin.",
    sentTitle: "Kargoya verdim",
    sentLead: "Paketi kargoya verince takip numarasını yazın; geldiğinde size haber verilir.",
    carrier: "Kargo firması",
    carriers: { dhl: "DHL", ups: "UPS", post: "Posta / PTT", client_courier: "Kendi kuryem", other: "Diğer", our_courier: "MB Dental kuryesi", customs: "Gümrük" },
    tracking: "Takip numarası",
    trackingHint: "DHL / UPS için zorunlu",
    count: "Paket sayısı",
    case: "İlgili vaka",
    none: "—",
    note: "Not",
    send: "Bildir",
    courierTitle: "Kurye ile alın",
    courierLead: "Ölçünüzü kuryemiz gelip alsın: gün ve saat aralığı seçin.",
    date: "Gün",
    slot: "Zaman",
    slots: { morning: "Sabah", afternoon: "Öğleden sonra", any: "Gün içinde" },
    address: "Adres",
    requestCourier: "Kurye talep et",
    list: "Gönderiler",
    incoming: "Bize gelen",
    outgoing: "Size giden",
    empty: "Henüz paket yok.",
    status: { expected: "Bekleniyor", in_transit: "Yolda", at_customs: "Gümrükte", out_for_delivery: "Dağıtımda", arrived: "Laboratuvara ulaştı", opened: "Açıldı", job_created: "İşleme alındı", ready: "Gönderime hazır", delivered: "Teslim edildi", returned: "İade", cancelled: "İptal" },
    ok: "Paket bildirildi. Teşekkürler!",
    okCourier: "Kurye talebiniz alındı.",
    errors: { tracking: "Geçerli bir takip numarası yazın.", courier_date: "Bugün ya da ileri bir gün seçin.", rate_limited: "Çok fazla bildirim yapıldı, yarın tekrar deneyin.", not_allowed: "Hesabınız aktif değil.", server: "Kaydedilemedi, lütfen tekrar deneyin." },
  },
  en: {
    nav: "My parcels",
    title: "My parcels",
    lead: "Impressions you send us and work we send you: track where they are.",
    sentTitle: "I have shipped a parcel",
    sentLead: "Enter the tracking number once you hand the parcel to the carrier; we will confirm when it arrives.",
    carrier: "Carrier",
    carriers: { dhl: "DHL", ups: "UPS", post: "Post", client_courier: "My own courier", other: "Other", our_courier: "MB Dental courier", customs: "Customs" },
    tracking: "Tracking number",
    trackingHint: "Required for DHL / UPS",
    count: "Number of parcels",
    case: "Related case",
    none: "—",
    note: "Note",
    send: "Notify",
    courierTitle: "Courier pickup",
    courierLead: "Our courier collects your impression: choose a day and time window.",
    date: "Day",
    slot: "Time",
    slots: { morning: "Morning", afternoon: "Afternoon", any: "Any time" },
    address: "Address",
    requestCourier: "Request pickup",
    list: "Shipments",
    incoming: "To the lab",
    outgoing: "To you",
    empty: "No parcels yet.",
    status: { expected: "Expected", in_transit: "In transit", at_customs: "At customs", out_for_delivery: "Out for delivery", arrived: "Arrived at the lab", opened: "Opened", job_created: "In production", ready: "Ready to ship", delivered: "Delivered", returned: "Returned", cancelled: "Cancelled" },
    ok: "Parcel registered. Thank you!",
    okCourier: "Pickup request received.",
    errors: { tracking: "Please enter a valid tracking number.", courier_date: "Choose today or a later day.", rate_limited: "Too many notifications, please try again tomorrow.", not_allowed: "Your account is not active.", server: "Could not save, please try again." },
  },
  fr: {
    nav: "Mes colis",
    title: "Mes colis",
    lead: "Les empreintes que vous nous envoyez et les travaux que nous vous expédions : suivez-les ici.",
    sentTitle: "J’ai expédié un colis",
    sentLead: "Indiquez le numéro de suivi après la remise au transporteur ; nous confirmerons sa réception.",
    carrier: "Transporteur",
    carriers: { dhl: "DHL", ups: "UPS", post: "La Poste", client_courier: "Mon coursier", other: "Autre", our_courier: "Coursier MB Dental", customs: "Douane" },
    tracking: "Numéro de suivi",
    trackingHint: "Obligatoire pour DHL / UPS",
    count: "Nombre de colis",
    case: "Cas concerné",
    none: "—",
    note: "Remarque",
    send: "Signaler",
    courierTitle: "Enlèvement par coursier",
    courierLead: "Notre coursier vient chercher votre empreinte : choisissez le jour et le créneau.",
    date: "Jour",
    slot: "Créneau",
    slots: { morning: "Matin", afternoon: "Après-midi", any: "Dans la journée" },
    address: "Adresse",
    requestCourier: "Demander l’enlèvement",
    list: "Envois",
    incoming: "Vers le laboratoire",
    outgoing: "Vers vous",
    empty: "Aucun colis pour le moment.",
    status: { expected: "Attendu", in_transit: "En transit", at_customs: "En douane", out_for_delivery: "En livraison", arrived: "Arrivé au laboratoire", opened: "Ouvert", job_created: "En production", ready: "Prêt à expédier", delivered: "Livré", returned: "Retourné", cancelled: "Annulé" },
    ok: "Colis enregistré. Merci !",
    okCourier: "Demande d’enlèvement reçue.",
    errors: { tracking: "Indiquez un numéro de suivi valide.", courier_date: "Choisissez aujourd’hui ou un jour ultérieur.", rate_limited: "Trop de signalements, réessayez demain.", not_allowed: "Votre compte n’est pas actif.", server: "Enregistrement impossible, réessayez." },
  },
};
