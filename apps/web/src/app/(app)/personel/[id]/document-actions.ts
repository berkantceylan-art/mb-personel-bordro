"use server";
import { revalidatePath } from "next/cache";
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
}
