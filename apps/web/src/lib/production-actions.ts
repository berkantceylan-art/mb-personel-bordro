"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import { done, fail } from "@/lib/flash";
import { parseQty } from "@/lib/stock";
import { prdError } from "@/lib/production";

const str = (f: FormData, k: string, max = 400) => String(f.get(k) ?? "").trim().slice(0, max);
const opt = (f: FormData, k: string, max = 400) => str(f, k, max) || null;

async function allowed(level = 2) {
  const s = await getSession();
  return (s.modules.production ?? 0) >= level || (level <= 2 && s.logistics);
}
const reval = (jobId?: string) => { revalidatePath("/uretim", "layout"); if (jobId) revalidatePath(`/isler/${jobId}`); revalidatePath("/stok", "layout"); };

export type ScanResult = { ok: boolean; message: string; job?: number; jobId?: string; patient?: string | null; action?: string; warnings?: { item: string; missing: number; unit: string }[] };

/** İstasyon terminali: okutulan iş için adımı başlat / bitir */
export async function scanJob(code: string, stationId: string, employeeId: string | null): Promise<ScanResult> {
  if (!(await allowed())) return { ok: false, message: prdError("not_allowed") };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("prd_scan", { p_code: code.slice(0, 200), p_station: stationId, p_employee: employeeId || null });
  if (error) return { ok: false, message: prdError(error.message) };
  const d = data as { job: number; job_id: string; patient: string | null; action: string; warnings?: { item: string; missing: number; unit: string }[] };
  reval(d.job_id);
  const verb = d.action === "started" ? "başladı" : d.action === "finished" ? "bitti" : "bu istasyonda zaten bitmiş";
  return { ok: true, message: `İş #${d.job}${d.patient ? ` · ${d.patient}` : ""}: ${verb}`, job: d.job, jobId: d.job_id, patient: d.patient, action: d.action, warnings: d.warnings ?? [] };
}

export async function opAction(form: FormData) {
  if (!(await allowed())) await fail(prdError("not_allowed"));
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("prd_op_action", { p_op: str(form, "id", 40), p_action: str(form, "action", 10), p_employee: opt(form, "employee_id", 40), p_note: opt(form, "note", 300) });
  if (error) await fail(prdError(error.message));
  const w = ((data as { warnings?: { item: string; missing: number; unit: string }[] })?.warnings ?? []);
  reval(str(form, "job_id", 40));
  await done(w.length ? `Kaydedildi. Stok yetersiz: ${w.map((x) => `${x.item} ${x.missing} ${x.unit}`).join(", ")}` : "Kaydedildi.");
}

export async function planJob(form: FormData) {
  if (!(await allowed())) await fail(prdError("not_allowed"));
  const supabase = await createClient();
  const id = str(form, "job_id", 40);
  const { data, error } = await supabase.rpc("prd_plan", { p_job: id });
  if (error) await fail(prdError(error.message));
  reval(id);
  await done(data ? `Üretime alındı: ${data} istasyon adımı oluştu.` : "İş zaten üretimde.");
}

export async function remakeJob(form: FormData) {
  if (!(await allowed())) await fail(prdError("not_allowed"));
  const supabase = await createClient();
  const id = str(form, "job_id", 40);
  const { error } = await supabase.rpc("prd_remake", {
    p_job: id, p_reason: str(form, "reason", 20) || "other", p_description: opt(form, "description", 500), p_station: opt(form, "station_id", 40),
    p_restart: opt(form, "restart_station_id", 40), p_chargeable: form.get("chargeable") === "on", p_employee: opt(form, "employee_id", 40),
  });
  if (error) await fail(prdError(error.message));
  reval(id);
  await done("Yeniden yapım kaydedildi; iş seçilen istasyondan tekrar başlıyor.");
}

export async function addJobMaterial(form: FormData) {
  if (!(await allowed())) await fail(prdError("not_allowed"));
  const supabase = await createClient();
  const id = str(form, "job_id", 40);
  const q = parseQty(str(form, "qty"));
  if (!q || q <= 0) await fail("Miktarı yazın.");
  const { error } = await supabase.rpc("prd_material_add", { p_job: id, p_item: str(form, "item_id", 40), p_qty: q, p_lot: opt(form, "lot_no", 60), p_warehouse: opt(form, "warehouse_id", 40) });
  if (error) await fail(prdError(error.message));
  reval(id);
  await done("Malzeme işe yazıldı ve stoktan düştü.");
}

// ---------------------------------------------------------------------
// Ayarlar: istasyonlar ve rotalar
// ---------------------------------------------------------------------
export async function saveStation(form: FormData) {
  if (!(await allowed(3))) await fail("İstasyon tanımı için üretim yönetici yetkisi gerekir.");
  const supabase = await createClient();
  const id = str(form, "id", 40);
  const row = {
    name: str(form, "name", 80) || "İstasyon", code: opt(form, "code", 20), kind: str(form, "kind", 20) || "other", color: /^#[0-9a-f]{6}$/i.test(str(form, "color")) ? str(form, "color") : null,
    sort: Number(str(form, "sort")) || 0, daily_capacity: Number(str(form, "daily_capacity")) || null, is_active: form.get("is_active") !== "off",
  };
  const { error } = id ? await supabase.from("prd_stations").update(row).eq("id", id) : await supabase.from("prd_stations").insert(row);
  if (error) await fail(prdError(error.message));
  reval();
  await done("İstasyon kaydedildi.");
}

/** Ürün rotası: işaretli istasyonlar sırayla, birim süre ve tüketim adımı */
export async function saveRoute(form: FormData) {
  if (!(await allowed())) await fail(prdError("not_allowed"));
  const supabase = await createClient();
  const product = str(form, "product_id", 40);
  const stations = form.getAll("station").map(String);
  const consume = str(form, "consume", 40);
  const rows = stations.map((sid, i) => ({ lab_product_id: product, station_id: sid, sort: i, std_minutes: Number(str(form, `min_${sid}`)) || null, consume: consume === sid }));
  const { error: de } = await supabase.from("prd_route_steps").delete().eq("lab_product_id", product);
  if (de) await fail(prdError(de.message));
  if (rows.length) {
    const { error } = await supabase.from("prd_route_steps").insert(rows);
    if (error) await fail(prdError(error.message));
  }
  // aynı rotayı başka ürünlere kopyala
  const copyTo = form.getAll("copy_to").map(String).filter((x) => x && x !== product);
  for (const p of copyTo) {
    await supabase.from("prd_route_steps").delete().eq("lab_product_id", p);
    if (rows.length) await supabase.from("prd_route_steps").insert(rows.map((r) => ({ ...r, lab_product_id: p })));
  }
  reval();
  await done(`Rota kaydedildi${copyTo.length ? ` ve ${copyTo.length} ürüne kopyalandı` : ""}.`);
}
