"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import { fail, must } from "@/lib/flash";

export async function uploadDocument(f: FormData) {
  const s = await getSession();
  if (!["owner", "accountant", "hr"].includes(s.role)) await fail("Yetkiniz yok");
  const employeeId = String(f.get("employeeId"));
  const typeId = String(f.get("typeId"));
  const file = f.get("file");
  if (!(file instanceof File) || file.size === 0) return;
  if (file.size > 10 * 1024 * 1024) await fail("Dosya 10 MB'tan büyük olamaz");
  const ext = (file.name.split(".").pop() ?? "bin").toLowerCase().replace(/[^a-z0-9]/g, "");
  const path = `${s.companyId}/employees/${employeeId}/${typeId}-${Date.now()}.${ext}`;
  const supabase = await createClient();
  const { error } = await supabase.storage.from("documents").upload(path, file, { contentType: file.type || undefined });
  if (error) await fail(error.message);
  const expires = String(f.get("expires_on") ?? "").trim() || null;
  await supabase.from("employee_documents").insert({
    company_id: s.companyId,
    employee_id: employeeId,
    document_type_id: typeId,
    file_path: path,
    file_name: file.name,
    expires_on: expires,
  });
  revalidatePath(`/personel/${employeeId}`);
  revalidatePath("/personel/[id]/kayit", "page");
  const next = String(f.get("next") ?? "");
  if (next.startsWith("/personel/")) redirect(next);
}

export async function deleteDocument(f: FormData) {
  const s = await getSession();
  if (!["owner", "accountant", "hr"].includes(s.role)) await fail("Yetkiniz yok");
  const id = String(f.get("id"));
  const employeeId = String(f.get("employeeId"));
  const supabase = await createClient();
  const { data } = await supabase.from("employee_documents").select("file_path").eq("id", id).maybeSingle();
  if (data?.file_path) await supabase.storage.from("documents").remove([data.file_path]);
  await must(supabase.from("employee_documents").delete().eq("id", id));
  revalidatePath(`/personel/${employeeId}`);
  revalidatePath("/personel/[id]/kayit", "page");
}

/** Personeli ofise çağır: bildirim + kayıt */
export async function callToOffice(f: FormData) {
  const s = await getSession();
  if (!["owner", "accountant", "hr", "branch_manager"].includes(s.role)) await fail("Yetkiniz yok");
  const employeeId = String(f.get("employeeId"));
  const onDate = String(f.get("on_date") ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(onDate)) await fail("Tarih seçin");
  const supabase = await createClient();
  const { error } = await supabase.from("office_calls").insert({
    company_id: s.companyId, employee_id: employeeId, on_date: onDate, at_time: String(f.get("at_time") ?? "") || null, reason: String(f.get("reason") ?? "").trim() || null,
  });
  if (error) await fail(error.message.includes("office_calls") ? "Supabase'de 20261101000000_profile_office_exit.sql çalıştırılmalı." : error.message);
  revalidatePath(`/personel/${employeeId}`);
  redirect(`/personel/${employeeId}?tamam=${encodeURIComponent("Personel ofise çağrıldı; telefonuna bildirim gitti.")}`);
}

export async function cancelOfficeCall(f: FormData) {
  const s = await getSession();
  if (!["owner", "accountant", "hr", "branch_manager"].includes(s.role)) await fail("Yetkiniz yok");
  const id = String(f.get("id")); const employeeId = String(f.get("employeeId"));
  const supabase = await createClient();
  await supabase.from("office_calls").update({ cancelled_at: new Date().toISOString() }).eq("id", id);
  revalidatePath(`/personel/${employeeId}`);
}
