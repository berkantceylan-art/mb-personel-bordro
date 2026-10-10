"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import { done, fail } from "@/lib/flash";
import { CARRIER, CONTENTS, FLOW, STATUS, normTracking, type Carrier, type ShipStatus } from "@/lib/shipments";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const missing = (m: string) => (/shipment/.test(m) && /exist|schema cache|relation/.test(m) ? "Supabase'de 20261124000000_shipments.sql çalıştırılmalı." : m);

async function guard() {
  const s = await getSession();
  if (!s.logistics) await fail("Kargo modülü için yetkiniz yok. Yönetim > Kullanıcılar'dan 'Laboratuvar / kargo' yetkisi verilmeli.");
  return s;
}

function revalidate(id?: string) {
  revalidatePath("/kargo");
  revalidatePath("/kargo/kurye");
  if (id) revalidatePath(`/kargo/${id}`);
}

/** Kuruş: "1.250,50" → 125050 */
function money(v: string): number | null {
  if (!v) return null;
  const n = Number(v.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
}

/** Yeni gönderi ya da düzenleme */
export async function saveShipment(f: FormData) {
  const s = await guard();
  const id = str(f, "id") || null;
  const direction = str(f, "direction") === "out" ? "out" : "in";
  const carrier = str(f, "carrier") as Carrier;
  if (!(carrier in CARRIER)) await fail("Kargo / taşıma türünü seçin.");
  const tracking = str(f, "tracking_no") ? normTracking(str(f, "tracking_no")) : null;
  if ((carrier === "dhl" || carrier === "ups") && !tracking) await fail("DHL / UPS için takip numarası girin.");
  const accountId = str(f, "portal_account_id") || null;
  const party = str(f, "party_name") || null;
  if (!accountId && !party) await fail("Gönderen / alıcıyı seçin ya da adını yazın.");
  const contents = f.getAll("contents").map(String).filter((c) => c in CONTENTS);
  const count = Math.min(99, Math.max(1, Number(str(f, "package_count")) || 1));
  const row = {
    company_id: s.companyId,
    direction,
    carrier,
    tracking_no: tracking,
    portal_account_id: accountId,
    portal_case_id: str(f, "portal_case_id") || null,
    party_name: party,
    country: str(f, "country") || null,
    city: str(f, "city") || null,
    address: str(f, "address") || null,
    phone: str(f, "phone") || null,
    package_count: count,
    contents,
    expected_on: str(f, "expected_on") || null,
    courier_date: carrier === "our_courier" ? str(f, "courier_date") || null : null,
    courier_slot: carrier === "our_courier" ? str(f, "courier_slot") || null : null,
    customs_broker: str(f, "customs_broker") || null,
    customs_ref: str(f, "customs_ref") || null,
    customs_cost: money(str(f, "customs_cost")),
    customs_currency: ["TRY", "EUR", "USD"].includes(str(f, "customs_currency")) ? str(f, "customs_currency") : "TRY",
    note: str(f, "note") || null,
  };
  if (carrier === "our_courier" && !row.courier_date) await fail("Kurye için alım / teslim gününü seçin.");
  const supabase = await createClient();
  let sid = id;
  if (id) {
    const { error } = await supabase.from("shipments").update(row).eq("id", id);
    if (error) await fail(missing(error.message));
  } else {
    const status = (str(f, "status") as ShipStatus) || (direction === "out" ? "ready" : "expected");
    const { data, error } = await supabase.from("shipments").insert({ ...row, status: status in STATUS ? status : "expected" }).select("id").single();
    if (error || !data) await fail(missing(error?.message ?? "Kaydedilemedi"));
    sid = data!.id as string;
  }
  revalidate(sid!);
  redirect(`/kargo/${sid}?tamam=${encodeURIComponent(id ? "Gönderi güncellendi." : "Gönderi kaydedildi.")}`);
}

/** Durum değiştir (+ isteğe bağlı not) */
export async function setShipmentStatus(f: FormData) {
  await guard();
  const id = str(f, "id");
  const status = str(f, "status") as ShipStatus;
  if (!(status in STATUS)) await fail("Geçersiz durum.");
  const supabase = await createClient();
  const { error } = await supabase.from("shipments").update({ status }).eq("id", id);
  if (error) await fail(missing(error.message));
  const note = str(f, "note");
  if (note) await supabase.from("shipment_events").insert({ shipment_id: id, status, note, source: "manual" });
  revalidate(id);
  await done(`Durum: ${STATUS[status][0]}`);
}

export async function addShipmentNote(f: FormData) {
  await guard();
  const id = str(f, "id");
  const note = str(f, "note").slice(0, 1000);
  if (!note) await fail("Not yazın.");
  const supabase = await createClient();
  const { error } = await supabase.from("shipment_events").insert({ shipment_id: id, note, source: "manual" });
  if (error) await fail(missing(error.message));
  revalidate(id);
  await done("Not eklendi.");
}

export async function deleteShipment(f: FormData) {
  const s = await guard();
  if (!["owner", "accountant", "hr"].includes(s.role)) await fail("Silme yetkisi yalnız sahip, muhasebe ve İK'da.");
  const id = str(f, "id");
  const supabase = await createClient();
  const { data: files } = await supabase.from("shipment_files").select("path").eq("shipment_id", id);
  if (files?.length) await supabase.storage.from("shipment-files").remove(files.map((x) => x.path as string));
  const { error } = await supabase.from("shipments").delete().eq("id", id);
  if (error) await fail(missing(error.message));
  revalidate();
  redirect(`/kargo?tamam=${encodeURIComponent("Gönderi silindi.")}`);
}

/** Tarayıcıdan depoya yüklenen dosyanın kaydı (yol, tür) */
export async function recordShipmentFile(input: { shipmentId: string; path: string; kind: "photo" | "document" | "signature"; name: string }) {
  const s = await getSession();
  if (!s.logistics) return { ok: false, message: "Yetkiniz yok." };
  if (!input.path.startsWith(`${input.shipmentId}/`)) return { ok: false, message: "Geçersiz dosya yolu." };
  const supabase = await createClient();
  const { error } = await supabase.from("shipment_files").insert({ shipment_id: input.shipmentId, path: input.path, kind: input.kind, name: input.name.slice(0, 200) });
  if (error) return { ok: false, message: missing(error.message) };
  revalidate(input.shipmentId);
  return { ok: true, message: "Yüklendi." };
}

/** Takip numarası / gönderi no ile ara (paket okutma ekranı) */
export async function findShipment(code: string): Promise<{ id: string; no: number; status: ShipStatus; label: string }[]> {
  const s = await getSession();
  if (!s.logistics) return [];
  const raw = normTracking(code).slice(0, 60);
  if (!raw) return [];
  const supabase = await createClient();
  const asNo = /^G?(\d{1,9})$/.exec(raw)?.[1];
  const q = supabase.from("shipments").select("id, no, status, carrier, party_name, tracking_no").order("created_at", { ascending: false }).limit(5);
  const { data } = asNo ? await q.or(`no.eq.${asNo},tracking_no.eq.${raw}`) : await q.ilike("tracking_no", `%${raw.replace(/[%_,()]/g, "")}%`);
  return (data ?? []).map((r) => ({ id: r.id as string, no: r.no as number, status: r.status as ShipStatus, label: `${CARRIER[r.carrier as Carrier]} · ${r.party_name ?? ""} · ${r.tracking_no ?? ""}` }));
}

/** Okutulan paketi "geldi" yap; kayıt yoksa yeni gelen gönderi aç */
export async function receiveByScan(f: FormData) {
  const s = await guard();
  const code = normTracking(str(f, "code"));
  const id = str(f, "id");
  const supabase = await createClient();
  if (id) {
    const { error } = await supabase.from("shipments").update({ status: "arrived" }).eq("id", id).in("status", FLOW.in.slice(0, 4));
    if (error) await fail(missing(error.message));
    await supabase.from("shipment_events").insert({ shipment_id: id, status: "arrived", note: "Okutularak teslim alındı", source: "scan" });
    revalidate(id);
    redirect(`/kargo/${id}?tamam=${encodeURIComponent("Paket teslim alındı. Açılış fotoğrafını çekin.")}`);
  }
  if (!code) await fail("Takip numarası okunamadı.");
  const carrier: Carrier = /^1Z/.test(code) ? "ups" : /^\d{10}$/.test(code) ? "dhl" : "other";
  const { data, error } = await supabase
    .from("shipments")
    .insert({ company_id: s.companyId, direction: "in", carrier, tracking_no: code, status: "arrived", party_name: "Bilinmiyor (okutuldu)" })
    .select("id")
    .single();
  if (error || !data) await fail(missing(error?.message ?? "Kaydedilemedi"));
  revalidate(data!.id as string);
  redirect(`/kargo/${data!.id}?duzenle=1&tamam=${encodeURIComponent("Yeni gelen paket açıldı; gönderen bilgisini tamamlayın.")}`);
}
