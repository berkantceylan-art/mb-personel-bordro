import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * DHL Express entegrasyonu
 *  - Takip: DHL Shipment Tracking – Unified API (developer.dhl.com) → DHL_TRACKING_KEY
 *  - Gönderi / etiket / fiyat / kurye: MyDHL API (REST) → DHL_API_USER, DHL_API_PASS, DHL_ACCOUNT_NO (+ isteğe bağlı DHL_IMPORT_ACCOUNT_NO)
 * Anahtarlar Vercel ortam değişkenlerinden okunur; yapıştırırken karışan boşluk / tırnak temizlenir.
 */
const env = (k: string) => (process.env[k] ?? "").trim().replace(/^["'`]+|["'`]+$/g, "");
export const dhlTrackingReady = () => !!env("DHL_TRACKING_KEY");
export const dhlApiReady = () => !!(env("DHL_API_USER") && env("DHL_API_PASS") && env("DHL_ACCOUNT_NO"));
export const dhlImportReady = () => dhlApiReady() && !!env("DHL_IMPORT_ACCOUNT_NO");

// ---------------------------------------------------------------------
// Takip
// ---------------------------------------------------------------------
type TrackEvent = { timestamp?: string; statusCode?: string; status?: string; description?: string; location?: { address?: { addressLocality?: string; countryCode?: string } } };
type TrackShipment = { id?: string; status?: TrackEvent; estimatedTimeOfDelivery?: string; events?: TrackEvent[] };
export type TrackResult = { status: string | null; dhl_status: string | null; event: string | null; event_at: string | null; place: string | null; eta: string | null; events: { at: string | null; text: string; place: string | null; code: string | null }[]; error: string | null };

const place = (e?: TrackEvent) => {
  const a = e?.location?.address;
  return a ? [a.addressLocality, a.countryCode].filter(Boolean).join(", ") || null : null;
};
const evText = (e?: TrackEvent) => (e ? [e.description || e.status].filter(Boolean).join(" ").trim() || null : null);

/** DHL olayını ERP durumuna çevir (gelen paket teslim → "Geldi", giden → "Teslim edildi") */
export function mapDhlStatus(direction: "in" | "out", e?: TrackEvent): string | null {
  if (!e) return null;
  const code = (e.statusCode ?? "").toLowerCase();
  const text = `${e.status ?? ""} ${e.description ?? ""}`.toLowerCase();
  if (code === "delivered") return direction === "in" ? "arrived" : "delivered";
  if (/customs|clearance|gümrük|douane|zoll/.test(text) && !/cleared|released|completed/.test(text)) return "at_customs";
  if (/with delivery courier|out for delivery|dağıtım|en cours de livraison/.test(text)) return "out_for_delivery";
  if (code === "transit") return "in_transit";
  return null;
}

/** Tek takip numarası sorgula */
export async function trackOne(trackingNo: string, direction: "in" | "out"): Promise<TrackResult> {
  const key = env("DHL_TRACKING_KEY");
  if (!key) throw new Error("DHL takip anahtarı tanımlı değil (Vercel: DHL_TRACKING_KEY)");
  const url = `https://api-eu.dhl.com/track/shipments?trackingNumber=${encodeURIComponent(trackingNo)}&service=express&language=en`;
  const res = await fetch(url, { headers: { "DHL-API-Key": key, Accept: "application/json" }, cache: "no-store" });
  const empty: TrackResult = { status: null, dhl_status: null, event: null, event_at: null, place: null, eta: null, events: [], error: null };
  if (res.status === 404) return { ...empty, error: "DHL bu numarayı henüz tanımıyor (yeni açılmış olabilir)" };
  if (res.status === 401 || res.status === 403) throw new Error("DHL takip anahtarı geçersiz (DHL_TRACKING_KEY)");
  if (res.status === 429) throw new Error("DHL günlük sorgu sınırı doldu; bir sonraki saatte tekrar denenecek");
  if (!res.ok) return { ...empty, error: `DHL ${res.status}: ${(await res.text()).slice(0, 200)}` };
  const j = (await res.json()) as { shipments?: TrackShipment[] };
  const sh = j.shipments?.[0];
  if (!sh) return { ...empty, error: "DHL yanıtında gönderi yok" };
  const events = (sh.events ?? []).slice(0, 20).map((e) => ({ at: e.timestamp ?? null, text: evText(e) ?? "", place: place(e), code: e.statusCode ?? null }));
  const last = sh.status ?? sh.events?.[0];
  return {
    status: mapDhlStatus(direction, last),
    dhl_status: last?.statusCode ?? null,
    event: evText(last),
    event_at: last?.timestamp ? new Date(last.timestamp).toISOString() : null,
    place: place(last),
    eta: sh.estimatedTimeOfDelivery ? sh.estimatedTimeOfDelivery.slice(0, 10) : null,
    events,
    error: null,
  };
}

/** Bekleyen DHL gönderilerini sorgular (cron). Ücretsiz anahtar: ~250 sorgu / gün, 5 sn'de 1 → her turda en çok `limit` paket. */
export async function pollDhl(sb: SupabaseClient, limit = 15): Promise<{ checked: number; changed: number; errors: number; notified: number }> {
  if (!dhlTrackingReady()) return { checked: 0, changed: 0, errors: 0, notified: 0 };
  const cutoff = new Date(Date.now() - 100 * 60 * 1000).toISOString();
  const { data } = await sb
    .from("shipments")
    .select("id, no, company_id, direction, tracking_no, status, party_name")
    .eq("carrier", "dhl")
    .not("tracking_no", "is", null)
    .not("status", "in", "(arrived,opened,job_created,delivered,returned,cancelled)")
    .or(`dhl_checked_at.is.null,dhl_checked_at.lt.${cutoff}`)
    .order("dhl_checked_at", { ascending: true, nullsFirst: true })
    .limit(limit);
  let checked = 0, changed = 0, errors = 0, notified = 0;
  for (const s of (data ?? []) as { id: string; no: number; company_id: string; direction: "in" | "out"; tracking_no: string; status: string; party_name: string | null }[]) {
    if (checked) await new Promise((r) => setTimeout(r, 5200));
    checked++;
    let r: TrackResult;
    try { r = await trackOne(s.tracking_no, s.direction); } catch (e) {
      errors++;
      await sb.rpc("dhl_apply_track", { p_id: s.id, p: { error: (e as Error).message } });
      if (/sınırı|geçersiz/.test((e as Error).message)) break;
      continue;
    }
    if (r.error) errors++;
    const { data: nw } = await sb.rpc("dhl_apply_track", { p_id: s.id, p: r });
    if (nw) {
      changed++;
      if (["at_customs", "arrived", "delivered"].includes(String(nw))) {
        const { data: mem } = await sb.from("memberships").select("user_id").eq("company_id", s.company_id).or("role.in.(owner,branch_manager),logistics_access.eq.true");
        const title = nw === "at_customs" ? `DHL G${s.no} gümrükte` : nw === "arrived" ? `DHL G${s.no} teslim edildi (bize)` : `DHL G${s.no} alıcıya teslim edildi`;
        const rows = (mem ?? []).map((m) => ({ company_id: s.company_id, user_id: m.user_id as string, title, body: `${s.party_name ?? ""} · ${s.tracking_no}${r.event ? ` · ${r.event}` : ""}`.slice(0, 300), link: `/kargo/${s.id}` }));
        if (rows.length) { await sb.from("notifications").insert(rows); notified += rows.length; }
      }
    }
  }
  return { checked, changed, errors, notified };
}

// ---------------------------------------------------------------------
// MyDHL API (gönderi açma, etiket, fiyat)
// ---------------------------------------------------------------------
export type DhlSettings = {
  test_mode: boolean; shipper_company: string; shipper_name: string | null; address1: string | null; address2: string | null; city: string | null; county: string | null;
  postal_code: string | null; country_code: string; phone: string | null; email: string | null; product_code: string; hs_code: string; item_desc: string; incoterm: string;
  currency: string; default_value: number; default_weight: number; length_cm: number; width_cm: number; height_cm: number; pickup_close: string; pickup_location: string;
};
export const DHL_DEFAULTS: DhlSettings = {
  test_mode: true, shipper_company: "MB Dental", shipper_name: null, address1: null, address2: null, city: null, county: null, postal_code: null, country_code: "TR", phone: null, email: null,
  product_code: "P", hs_code: "902129", item_desc: "Custom-made dental prosthesis (medical device)", incoterm: "DAP", currency: "EUR", default_value: 50, default_weight: 0.5,
  length_cm: 20, width_cm: 15, height_cm: 10, pickup_close: "18:00", pickup_location: "Resepsiyon",
};

export type Party = { company: string; name: string; address1: string; address2?: string; city: string; postal: string; country: string; phone: string; email?: string };
export type DhlShipmentInput = {
  mode: "export" | "import";          // export: biz → hekim; import: hekim → biz (ithalat hesabımızla alım)
  other: Party;                        // hekim / klinik
  weight: number; length: number; width: number; height: number; packages: number;
  value: number; currency: string; description: string; invoiceNo: string;
  shipDate: string;                    // YYYY-MM-DD
  pickup: boolean; pickupReady?: string; pickupClose?: string;
  productCode?: string;
};

const base = (s: DhlSettings) => (s.test_mode ? "https://express.api.dhl.com/mydhlapi/test" : "https://express.api.dhl.com/mydhlapi");
const auth = () => "Basic " + Buffer.from(`${env("DHL_API_USER")}:${env("DHL_API_PASS")}`).toString("base64");

function dhlError(status: number, body: string) {
  try {
    const j = JSON.parse(body) as { title?: string; detail?: string; additionalDetails?: string[] };
    const extra = (j.additionalDetails ?? []).slice(0, 4).join(" · ");
    if (status === 401) return "MyDHL API kullanıcı adı / şifresi geçersiz (DHL_API_USER / DHL_API_PASS) ya da test / canlı modu yanlış.";
    return `DHL ${status}: ${[j.title, j.detail, extra].filter(Boolean).join(" — ")}`.slice(0, 600);
  } catch { return `DHL ${status}: ${body.slice(0, 300)}`; }
}

function ourParty(s: DhlSettings): Party {
  const miss = (["address1", "city", "postal_code", "phone"] as const).filter((k) => !s[k]);
  if (miss.length) throw new Error("Kargo › DHL ayarlarından laboratuvar adresini (adres, şehir, posta kodu, telefon) doldurun.");
  return { company: s.shipper_company, name: s.shipper_name || s.shipper_company, address1: s.address1!, address2: s.address2 ?? undefined, city: s.city!, postal: s.postal_code!, country: s.country_code, phone: s.phone!, email: s.email ?? undefined };
}
const partyJson = (p: Party) => ({
  postalAddress: { postalCode: p.postal, cityName: p.city, countryCode: p.country.toUpperCase(), addressLine1: p.address1.slice(0, 45), ...(p.address2 ? { addressLine2: p.address2.slice(0, 45) } : {}) },
  contactInformation: { phone: p.phone, companyName: (p.company || p.name).slice(0, 100), fullName: (p.name || p.company).slice(0, 255), ...(p.email ? { email: p.email } : {}) },
});

/** Fiyat ve teslim süresi (gönderi açmadan) */
export async function dhlRates(s: DhlSettings, i: DhlShipmentInput) {
  if (!dhlApiReady()) throw new Error("MyDHL API bilgileri tanımlı değil (Vercel: DHL_API_USER, DHL_API_PASS, DHL_ACCOUNT_NO)");
  const us = ourParty(s);
  const [from, to] = i.mode === "export" ? [us, i.other] : [i.other, us];
  const account = i.mode === "import" ? env("DHL_IMPORT_ACCOUNT_NO") || env("DHL_ACCOUNT_NO") : env("DHL_ACCOUNT_NO");
  const q = new URLSearchParams({
    accountNumber: account, originCountryCode: from.country, originCityName: from.city, originPostalCode: from.postal,
    destinationCountryCode: to.country, destinationCityName: to.city, destinationPostalCode: to.postal,
    weight: String(i.weight), length: String(i.length), width: String(i.width), height: String(i.height),
    plannedShippingDate: i.shipDate, isCustomsDeclarable: String(from.country !== to.country), unitOfMeasurement: "metric",
  });
  const res = await fetch(`${base(s)}/rates?${q}`, { headers: { Authorization: auth(), Accept: "application/json" }, cache: "no-store" });
  const body = await res.text();
  if (!res.ok) throw new Error(dhlError(res.status, body));
  type P = { productName?: string; productCode?: string; totalPrice?: { currencyType?: string; priceCurrency?: string; price?: number }[]; deliveryCapabilities?: { estimatedDeliveryDateAndTime?: string; totalTransitDays?: string } };
  return ((JSON.parse(body) as { products?: P[] }).products ?? []).map((p) => {
    const price = p.totalPrice?.find((t) => t.currencyType === "BILLC") ?? p.totalPrice?.[0];
    return { name: p.productName ?? p.productCode ?? "", code: p.productCode ?? "", price: price?.price ?? null, currency: price?.priceCurrency ?? null, eta: p.deliveryCapabilities?.estimatedDeliveryDateAndTime?.slice(0, 10) ?? null, days: p.deliveryCapabilities?.totalTransitDays ?? null };
  });
}

/** Gönderi aç: takip no + etiket PDF + ticari fatura PDF (+ kurye talebi) */
export async function dhlCreate(s: DhlSettings, i: DhlShipmentInput) {
  if (!dhlApiReady()) throw new Error("MyDHL API bilgileri tanımlı değil (Vercel: DHL_API_USER, DHL_API_PASS, DHL_ACCOUNT_NO)");
  if (i.mode === "import" && !env("DHL_IMPORT_ACCOUNT_NO")) throw new Error("Alım (ithalat) gönderisi için DHL ithalat hesap numarası gerekir (Vercel: DHL_IMPORT_ACCOUNT_NO)");
  const us = ourParty(s);
  const [shipper, receiver] = i.mode === "export" ? [us, i.other] : [i.other, us];
  const customs = shipper.country !== receiver.country;
  const account = i.mode === "import" ? env("DHL_IMPORT_ACCOUNT_NO") : env("DHL_ACCOUNT_NO");
  const n = Math.max(1, Math.min(9, i.packages));
  const perPkg = Math.max(0.1, Math.round((i.weight / n) * 1000) / 1000);
  const offset = "GMT+03:00";
  const body = {
    plannedShippingDateAndTime: `${i.shipDate}T${i.pickup ? (i.pickupReady || "14:00") : "16:00"}:00 ${offset}`,
    pickup: i.pickup ? { isRequested: true, closeTime: i.pickupClose || s.pickup_close, location: s.pickup_location } : { isRequested: false },
    productCode: i.productCode || s.product_code,
    accounts: [{ typeCode: "shipper", number: account }],
    outputImageProperties: {
      printerDPI: 300, encodingFormat: "pdf",
      imageOptions: [
        { typeCode: "label", templateName: "ECOM26_84_001", isRequested: true },
        ...(customs ? [{ typeCode: "invoice", templateName: "COMMERCIAL_INVOICE_P_10", isRequested: true, invoiceType: "commercial" }] : []),
      ],
    },
    customerDetails: { shipperDetails: partyJson(shipper), receiverDetails: partyJson(receiver) },
    content: {
      packages: Array.from({ length: n }, () => ({ weight: perPkg, dimensions: { length: i.length, width: i.width, height: i.height } })),
      isCustomsDeclarable: customs,
      ...(customs ? {
        declaredValue: i.value, declaredValueCurrency: i.currency,
        exportDeclaration: {
          lineItems: [{
            number: 1, description: i.description.slice(0, 512), price: i.value, quantity: { value: 1, unitOfMeasurement: "PCS" },
            commodityCodes: [{ typeCode: "outbound", value: s.hs_code }, { typeCode: "inbound", value: s.hs_code }],
            exportReasonType: i.mode === "export" ? "permanent" : "temporary", manufacturerCountry: shipper.country,
            weight: { netValue: Math.max(0.01, i.weight * 0.8), grossValue: i.weight },
          }],
          invoice: { number: i.invoiceNo.slice(0, 35), date: i.shipDate },
          exportReason: i.mode === "export" ? "Sale of custom-made dental prosthesis" : "Dental impressions / models for prosthesis production",
        },
      } : {}),
      description: i.description.slice(0, 70),
      incoterm: s.incoterm,
      unitOfMeasurement: "metric",
    },
  };
  const res = await fetch(`${base(s)}/shipments`, { method: "POST", headers: { Authorization: auth(), "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(body), cache: "no-store" });
  const text = await res.text();
  if (!res.ok) throw new Error(dhlError(res.status, text));
  type R = { shipmentTrackingNumber?: string; dispatchConfirmationNumber?: string; packages?: { trackingNumber?: string }[]; documents?: { imageFormat?: string; content?: string; typeCode?: string }[]; shipmentCharges?: { currencyType?: string; priceCurrency?: string; price?: number }[] };
  const r = JSON.parse(text) as R;
  const charge = r.shipmentCharges?.find((c) => c.currencyType === "BILLC") ?? r.shipmentCharges?.[0];
  return {
    trackingNo: r.shipmentTrackingNumber ?? r.packages?.[0]?.trackingNumber ?? null,
    pickupRef: r.dispatchConfirmationNumber ?? null,
    documents: (r.documents ?? []).filter((d) => d.content).map((d) => ({ type: d.typeCode ?? "document", pdf: Buffer.from(d.content!, "base64") })),
    cost: charge?.price != null ? Math.round(charge.price * 100) : null,
    costCurrency: charge?.priceCurrency ?? null,
  };
}

// ---------------------------------------------------------------------
// Ülke adı → ISO kodu
// ---------------------------------------------------------------------
const CC: Record<string, string> = {
  turkiye: "TR", turkey: "TR", tr: "TR", fransa: "FR", france: "FR", belcika: "BE", belgique: "BE", belgium: "BE", almanya: "DE", germany: "DE", deutschland: "DE",
  isvicre: "CH", suisse: "CH", switzerland: "CH", schweiz: "CH", hollanda: "NL", netherlands: "NL", nederland: "NL", luksemburg: "LU", luxembourg: "LU",
  ingiltere: "GB", "birlesik krallik": "GB", uk: "GB", "united kingdom": "GB", england: "GB", italya: "IT", italy: "IT", italia: "IT", ispanya: "ES", spain: "ES", espana: "ES",
  avusturya: "AT", austria: "AT", osterreich: "AT", kanada: "CA", canada: "CA", abd: "US", usa: "US", "united states": "US", "amerika": "US", fas: "MA", maroc: "MA", morocco: "MA",
  cezayir: "DZ", algerie: "DZ", algeria: "DZ", tunus: "TN", tunisie: "TN", tunisia: "TN", monako: "MC", monaco: "MC", portekiz: "PT", portugal: "PT", irlanda: "IE", ireland: "IE",
  danimarka: "DK", denmark: "DK", isvec: "SE", sweden: "SE", norvec: "NO", norway: "NO", yunanistan: "GR", greece: "GR", kibris: "CY", cyprus: "CY", azerbaycan: "AZ", azerbaijan: "AZ",
  "birlesik arap emirlikleri": "AE", bae: "AE", uae: "AE", katar: "QA", qatar: "QA", "suudi arabistan": "SA", "saudi arabia": "SA", israil: "IL", israel: "IL", lubnan: "LB", liban: "LB", lebanon: "LB",
};
export function countryCode(v: string | null | undefined): string | null {
  if (!v) return null;
  const t = v.trim();
  if (/^[A-Za-z]{2}$/.test(t)) return t.toUpperCase();
  const k = t.toLocaleLowerCase("tr").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ı/g, "i").trim();
  return CC[k] ?? null;
}
