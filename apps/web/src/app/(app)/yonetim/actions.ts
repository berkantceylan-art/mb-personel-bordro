"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import { done, fail, must } from "@/lib/flash";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
type R = { ok: boolean; message: string };

async function requireAdmin() {
  const s = await getSession();
  if (s.role !== "owner" && (s.modules.users ?? 0) < 2) await fail("Yetkiniz yok");
  return s;
}

export async function deleteInvite(f: FormData) {
  await requireAdmin();
  const supabase = await createClient();
  await must(supabase.from("invites").delete().eq("id", str(f, "id")));
  revalidatePath("/yonetim");
}

export async function saveBranch(_: R | null, f: FormData): Promise<R> {
  const s = await getSession();
  if (s.role !== "owner") return { ok: false, message: "Şubeleri sadece şirket sahibi düzenleyebilir." };
  const supabase = await createClient();
  const id = str(f, "id");
  const lat = str(f, "lat") ? Number(str(f, "lat").replace(",", ".")) : null;
  const lng = str(f, "lng") ? Number(str(f, "lng").replace(",", ".")) : null;
  if ((lat !== null && !(lat >= -90 && lat <= 90)) || (lng !== null && !(lng >= -180 && lng <= 180))) return { ok: false, message: "Konum geçersiz." };
  const row = {
    company_id: s.companyId,
    name: str(f, "name"),
    address: str(f, "address") || null,
    lat,
    lng,
    radius_m: Number(str(f, "radius_m") || 150),
    mobile_punch_enabled: f.get("mobile_punch_enabled") === "on",
  };
  if (!row.name) return { ok: false, message: "Şube adı zorunlu." };
  const { error } = id ? await supabase.from("branches").update(row).eq("id", id) : await supabase.from("branches").insert(row);
  if (error) return { ok: false, message: error.message };
  if (!id) {
    const { data: b } = await supabase.from("branches").select("id").eq("company_id", s.companyId).eq("name", row.name).single();
    if (b) await supabase.from("devices").insert([{ company_id: s.companyId, branch_id: b.id, code: "002", direction: "IN", name: "Giriş" }, { company_id: s.companyId, branch_id: b.id, code: "001", direction: "OUT", name: "Çıkış" }]);
  }
  revalidatePath("/yonetim");
  return { ok: true, message: "Şube kaydedildi." };
}

export async function saveDepartment(f: FormData) {
  await requireAdmin();
  const s = await getSession();
  const supabase = await createClient();
  const id = str(f, "id");
  const name = str(f, "name");
  if (!name) return;
  if (id) await supabase.from("departments").update({ name }).eq("id", id);
  else await supabase.from("departments").insert({ company_id: s.companyId, name });
  revalidatePath("/yonetim");
}

export async function deleteDepartment(f: FormData) {
  await requireAdmin();
  const supabase = await createClient();
  const id = str(f, "id");
  const { count } = await supabase.from("employees").select("id", { count: "exact", head: true }).eq("department_id", id);
  if ((count ?? 0) > 0) return;
  await supabase.from("departments").delete().eq("id", id);
  revalidatePath("/yonetim");
}

export async function saveDevice(f: FormData) {
  const s = await getSession();
  if (s.role !== "owner") return;
  const supabase = await createClient();
  const id = str(f, "id");
  const row = { company_id: s.companyId, branch_id: str(f, "branch_id"), code: str(f, "code"), direction: str(f, "direction") === "OUT" ? "OUT" : "IN", name: str(f, "name") || null };
  if (!row.code || !row.branch_id) return;
  if (id) await supabase.from("devices").update(row).eq("id", id);
  else await supabase.from("devices").insert(row);
  revalidatePath("/yonetim");
}

export async function deleteDevice(f: FormData) {
  const s = await getSession();
  if (s.role !== "owner") return;
  const supabase = await createClient();
  await supabase.from("devices").delete().eq("id", str(f, "id"));
  revalidatePath("/yonetim");
}

/** Şirket bilgileri (sözleşme ve formlara yazılır) */
export async function saveCompanyInfo(f: FormData) {
  const s = await getSession();
  if (s.role !== "owner") await fail("Şirket bilgilerini sadece şirket sahibi düzenleyebilir.");
  const supabase = await createClient();
  const row = {
    name: str(f, "name"),
    address: str(f, "address") || null,
    phone: str(f, "phone") || null,
    email: str(f, "email") || null,
    tax_office: str(f, "tax_office") || null,
    tax_no: str(f, "tax_no") || null,
    sgk_registration_no: str(f, "sgk_registration_no") || null,
    lab_license_no: str(f, "lab_license_no") || null,
    uts_firm_no: str(f, "uts_firm_no") || null,
    mdr_person: str(f, "mdr_person") || null,
    mdr_person_title: str(f, "mdr_person_title") || null,
  };
  if (!row.name) await fail("Şirket unvanı zorunlu.");
  const { error } = await supabase.from("companies").update(row).eq("id", s.companyId);
  if (error) await fail(error.message.includes("column") ? "Şirket bilgi alanları henüz eklenmemiş: Supabase'de 20261029000000_onboarding_docs.sql dosyasını çalıştırın." : error.message);
  revalidatePath("/yonetim");
  await done("Şirket bilgileri kaydedildi.");
}
