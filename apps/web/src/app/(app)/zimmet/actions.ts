"use server";
import { revalidatePath } from "next/cache";
import { parseTL } from "@mb/core";
import { createClient } from "@/lib/supabase/server";
import { getSession, todayIso } from "@/lib/session";
import { done, fail } from "@/lib/flash";

const CAN = ["owner", "accountant", "hr", "branch_manager"];
const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const missing = (m: string) => (m.includes("assets") || m.includes("asset_assignments") ? "Supabase'de 20261103000000_assets.sql çalıştırılmalı." : m);

function revalidate(employeeId?: string | null) {
  revalidatePath("/zimmet");
  if (employeeId) { revalidatePath(`/personel/${employeeId}`); revalidatePath(`/personel/${employeeId}/cikis`); }
  revalidatePath("/benim/zimmet");
}

/** Demirbaş ekle / düzenle; isteğe bağlı aynı anda personele zimmetle */
export async function saveAsset(f: FormData) {
  const s = await getSession();
  if (!CAN.includes(s.role)) await fail("Yetkiniz yok.");
  const id = str(f, "id") || null;
  const name = str(f, "name");
  if (!name) await fail("Demirbaş adı zorunlu.");
  let value: number | null = null;
  if (str(f, "value")) { try { value = parseTL(str(f, "value")); } catch { await fail("Değer okunamadı (ör. 12.500)."); } }
  const row = {
    company_id: s.companyId, code: str(f, "code") || null, name, category: str(f, "category") || "DIGER", brand_model: str(f, "brand_model") || null,
    serial_no: str(f, "serial_no") || null, purchase_date: str(f, "purchase_date") || null, value, note: str(f, "note") || null, updated_at: new Date().toISOString(),
    ...(id ? {} : { status: "AVAILABLE" }),
  };
  const supabase = await createClient();
  let assetId = id;
  if (id) {
    const status = str(f, "status");
    const { error } = await supabase.from("assets").update({ ...row, ...(status && ["AVAILABLE", "MAINTENANCE", "LOST", "RETIRED"].includes(status) ? { status } : {}) }).eq("id", id);
    if (error) await fail(error.message.includes("unique") ? "Bu demirbaş numarası zaten kayıtlı." : missing(error.message));
  } else {
    const { data, error } = await supabase.from("assets").insert(row).select("id").single();
    if (error || !data) await fail(error ? (error.message.includes("unique") ? "Bu demirbaş numarası zaten kayıtlı." : missing(error.message)) : "Kaydedilemedi");
    assetId = data!.id;
  }
  const employeeId = str(f, "employee_id");
  if (employeeId && assetId) {
    const { error } = await supabase.from("asset_assignments").insert({ company_id: s.companyId, asset_id: assetId, employee_id: employeeId, assigned_on: str(f, "assigned_on") || todayIso(), condition_out: str(f, "condition_out") || "Sağlam", note: str(f, "assign_note") || null });
    if (error) await fail(error.message.includes("asset_assign_open_uidx") ? "Bu demirbaş zaten başka personelde zimmetli." : missing(error.message));
  }
  revalidate(employeeId || null);
  await done(id ? "Demirbaş güncellendi." : employeeId ? "Demirbaş eklendi ve zimmetlendi; personele bildirim gitti." : "Demirbaş eklendi.");
}

/** Boştaki demirbaşı personele zimmetle */
export async function assignAsset(f: FormData) {
  const s = await getSession();
  if (!CAN.includes(s.role)) await fail("Yetkiniz yok.");
  const assetId = str(f, "asset_id"); const employeeId = str(f, "employee_id");
  if (!assetId || !employeeId) await fail("Demirbaş ve personel seçin.");
  const supabase = await createClient();
  const { error } = await supabase.from("asset_assignments").insert({ company_id: s.companyId, asset_id: assetId, employee_id: employeeId, assigned_on: str(f, "assigned_on") || todayIso(), condition_out: str(f, "condition_out") || "Sağlam", note: str(f, "note") || null });
  if (error) await fail(error.message.includes("asset_assign_open_uidx") ? "Bu demirbaş zaten zimmetli." : missing(error.message));
  revalidate(employeeId);
  await done("Zimmet verildi; personele bildirim gitti. Tutanağı indirip imzalatın.");
}

/** İade al */
export async function returnAsset(f: FormData) {
  const s = await getSession();
  if (!CAN.includes(s.role)) await fail("Yetkiniz yok.");
  const id = str(f, "id");
  const supabase = await createClient();
  const { data: a } = await supabase.from("asset_assignments").select("employee_id").eq("id", id).maybeSingle();
  const { error } = await supabase.from("asset_assignments").update({ returned_on: str(f, "returned_on") || todayIso(), condition_in: str(f, "condition_in") || "Sağlam", return_note: str(f, "return_note") || null }).eq("id", id).is("returned_on", null);
  if (error) await fail(missing(error.message));
  revalidate(a?.employee_id);
  await done("İade alındı.");
}

export async function deleteAsset(f: FormData) {
  const s = await getSession();
  if (!["owner", "hr"].includes(s.role)) await fail("Yetkiniz yok.");
  const supabase = await createClient();
  const { error } = await supabase.from("assets").delete().eq("id", str(f, "id")).eq("status", "AVAILABLE");
  if (error) await fail(error.message);
  revalidate();
  await done("Demirbaş silindi.");
}

/** Personel: teslim aldığını onaylar */
export async function acknowledgeAsset(f: FormData) {
  await getSession();
  const supabase = await createClient();
  const { error } = await supabase.from("asset_assignments").update({ acknowledged_at: new Date().toISOString() }).eq("id", str(f, "id")).is("acknowledged_at", null);
  if (error) await fail(error.message);
  revalidatePath("/benim/zimmet"); revalidatePath("/benim");
}
