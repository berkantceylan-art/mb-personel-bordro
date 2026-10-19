"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import { done, fail } from "@/lib/flash";
import { DHL_DEFAULTS, countryCode, dhlCreate, dhlRates, trackOne, type DhlSettings, type DhlShipmentInput } from "@/lib/dhl";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const num = (f: FormData, k: string, d: number) => {
  const n = Number(str(f, k).replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : d;
};
const missing = (m: string) => (/dhl_|schema cache|does not exist/.test(m) ? "Supabase'de mbdental-dhl.sql çalıştırılmalı." : m);

async function guard() {
  const s = await getSession();
  if (!s.logistics) await fail("Kargo modülü için yetkiniz yok.");
  return s;
}

export async function loadDhlSettings(): Promise<DhlSettings> {
  const sb = await createClient();
  const { data } = await sb.from("dhl_settings").select("*").maybeSingle();
  return { ...DHL_DEFAULTS, ...((data ?? {}) as Partial<DhlSettings>) };
}

/** DHL ayarları (laboratuvar adresi ve varsayılanlar) */
export async function saveDhlSettings(f: FormData) {
  const s = await guard();
  const row = {
    company_id: s.companyId,
    test_mode: str(f, "test_mode") !== "live",
    shipper_company: str(f, "shipper_company") || "MB Dental",
    shipper_name: str(f, "shipper_name") || null,
    address1: str(f, "address1") || null,
    address2: str(f, "address2") || null,
    city: str(f, "city") || null,
    county: str(f, "county") || null,
    postal_code: str(f, "postal_code") || null,
    country_code: (countryCode(str(f, "country_code")) ?? "TR"),
    phone: str(f, "phone") || null,
    email: str(f, "email") || null,
    product_code: str(f, "product_code") || "P",
    hs_code: str(f, "hs_code").replace(/\D/g, "") || "902129",
    item_desc: str(f, "item_desc") || DHL_DEFAULTS.item_desc,
    incoterm: str(f, "incoterm") || "DAP",
    currency: str(f, "currency") || "EUR",
    default_value: num(f, "default_value", 50),
    default_weight: num(f, "default_weight", 0.5),
    length_cm: Math.round(num(f, "length_cm", 20)),
    width_cm: Math.round(num(f, "width_cm", 15)),
    height_cm: Math.round(num(f, "height_cm", 10)),
    pickup_close: str(f, "pickup_close") || "18:00",
    pickup_location: str(f, "pickup_location") || "Resepsiyon",
    updated_at: new Date().toISOString(),
  };
  const { error } = await (await createClient()).from("dhl_settings").upsert(row, { onConflict: "company_id" });
  if (error) await fail(missing(error.message));
  revalidatePath("/kargo/dhl");
  await done("DHL ayarları kaydedildi.");
}

/** Detay ekranı: şimdi DHL'den sorgula */
export async function trackNow(f: FormData) {
  await guard();
  const id = str(f, "id");
  const sb = await createClient();
  const { data: x } = await sb.from("shipments").select("tracking_no, direction").eq("id", id).maybeSingle();
  if (!x?.tracking_no) await fail("Takip numarası yok.");
  let r;
  try { r = await trackOne(x!.tracking_no as string, x!.direction as "in" | "out"); } catch (e) { await fail((e as Error).message); return; }
  const { data: nw, error } = await sb.rpc("dhl_apply_track", { p_id: id, p: r });
  if (error) await fail(missing(error.message));
  revalidatePath(`/kargo/${id}`);
  revalidatePath("/kargo");
  if (r.error) await fail(r.error);
  await done(nw ? `DHL: durum güncellendi.` : `DHL: ${r.event ?? "yeni bilgi yok"}.`);
}

function inputFrom(f: FormData, st: DhlSettings): DhlShipmentInput {
  const cc = countryCode(str(f, "r_country"));
  if (!cc) throw new Error("Alıcı / gönderen ülkesini seçin.");
  for (const [k, l] of [["r_name", "Ad / klinik"], ["r_address1", "Adres"], ["r_city", "Şehir"], ["r_postal", "Posta kodu"], ["r_phone", "Telefon"]] as const)
    if (!str(f, k)) throw new Error(`${l} zorunlu.`);
  return {
    mode: str(f, "mode") === "import" ? "import" : "export",
    other: { company: str(f, "r_company") || str(f, "r_name"), name: str(f, "r_name"), address1: str(f, "r_address1"), address2: str(f, "r_address2") || undefined, city: str(f, "r_city"), postal: str(f, "r_postal"), country: cc, phone: str(f, "r_phone"), email: str(f, "r_email") || undefined },
    weight: num(f, "weight", st.default_weight), length: Math.round(num(f, "length", st.length_cm)), width: Math.round(num(f, "width", st.width_cm)), height: Math.round(num(f, "height", st.height_cm)),
    packages: Math.round(num(f, "packages", 1)), value: num(f, "value", st.default_value), currency: str(f, "currency") || st.currency,
    description: str(f, "description") || st.item_desc, invoiceNo: str(f, "invoice_no") || `G${str(f, "no")}`,
    shipDate: /^\d{4}-\d{2}-\d{2}$/.test(str(f, "ship_date")) ? str(f, "ship_date") : new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10),
    pickup: f.get("pickup") === "on", pickupReady: str(f, "pickup_ready") || undefined, pickupClose: str(f, "pickup_close") || undefined,
    productCode: str(f, "product_code") || undefined,
  };
}

export type RateRow = { name: string; code: string; price: number | null; currency: string | null; eta: string | null; days: string | null };

/** Fiyat sor (form doldurulurken; sayfa yenilenmez) */
export async function dhlQuote(f: FormData): Promise<{ ok: boolean; message?: string; rates?: RateRow[] }> {
  const s = await getSession();
  if (!s.logistics) return { ok: false, message: "Yetkiniz yok." };
  try {
    const st = await loadDhlSettings();
    return { ok: true, rates: await dhlRates(st, inputFrom(f, st)) };
  } catch (e) { return { ok: false, message: (e as Error).message }; }
}

/** DHL'de gönderi aç: takip no, etiket ve fatura PDF'leri gönderiye eklenir */
export async function dhlCreateShipment(f: FormData): Promise<{ ok: boolean; message: string }> {
  const s = await getSession();
  if (!s.logistics) return { ok: false, message: "Yetkiniz yok." };
  const id = str(f, "id");
  const sb = await createClient();
  const { data: x } = await sb.from("shipments").select("id, no, direction, tracking_no, dhl_created").eq("id", id).maybeSingle();
  if (!x) return { ok: false, message: "Gönderi bulunamadı." };
  if (x.dhl_created && x.tracking_no) return { ok: false, message: `Bu gönderi DHL'de zaten açılmış (${x.tracking_no}).` };
  try {
    const st = await loadDhlSettings();
    const inp = inputFrom(f, st);
    const r = await dhlCreate(st, inp);
    // PDF'leri sakla
    for (const d of r.documents) {
      const path = `${id}/dhl-${d.type}-${r.trackingNo ?? Date.now()}.pdf`;
      const up = await sb.storage.from("shipment-files").upload(path, d.pdf, { contentType: "application/pdf", upsert: true });
      if (!up.error) await sb.from("shipment_files").insert({ shipment_id: id, path, kind: "document", name: d.type === "label" ? "DHL etiketi" : d.type === "invoice" ? "Ticari fatura" : `DHL ${d.type}` });
    }
    const { error } = await sb.from("shipments").update({
      tracking_no: r.trackingNo, dhl_created: true, dhl_product: inp.productCode ?? st.product_code, dhl_pickup_ref: r.pickupRef, dhl_weight: inp.weight,
      dhl_cost: r.cost, dhl_cost_currency: r.costCurrency, country_code: inp.other.country, postal_code: inp.other.postal, email: inp.other.email ?? null,
      party_name: inp.other.company || inp.other.name, city: inp.other.city, address: [inp.other.address1, inp.other.address2].filter(Boolean).join("\n"), phone: inp.other.phone,
      ...(x.direction === "out" ? { status: "ready" } : {}),
    }).eq("id", id);
    if (error) return { ok: false, message: `DHL gönderisi açıldı (${r.trackingNo}) ama kaydedilemedi: ${error.message}` };
    await sb.from("shipment_events").insert({ shipment_id: id, status: null, source: "dhl", note: `DHL gönderisi açıldı: ${r.trackingNo}${r.pickupRef ? ` · kurye talebi ${r.pickupRef}` : ""}${st.test_mode ? " (TEST)" : ""}` });
    revalidatePath(`/kargo/${id}`);
    revalidatePath("/kargo");
    return { ok: true, message: `DHL gönderisi açıldı: ${r.trackingNo}. Etiket${r.documents.length > 1 ? " ve ticari fatura" : ""} "Fotoğraf ve belgeler" bölümünde.${r.pickupRef ? ` Kurye talebi: ${r.pickupRef}.` : ""}${st.test_mode ? " (TEST modu — gerçek gönderi değildir)" : ""}` };
  } catch (e) { return { ok: false, message: missing((e as Error).message) }; }
}
