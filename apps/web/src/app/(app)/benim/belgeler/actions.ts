"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import { done, fail } from "@/lib/flash";

/** Personel kendi belgesini yükler (sadece sihirbazın 2. adımındaki belge türleri) */
export async function uploadMyDocument(f: FormData) {
  const s = await getSession();
  const supabase = await createClient();
  const { data: me } = await supabase.from("employees").select("id").eq("user_id", s.userId).maybeSingle();
  if (!me) await fail("Hesabınız bir personel kaydına bağlı değil.");
  const typeId = String(f.get("typeId"));
  const { data: t } = await supabase.from("document_types").select("id, onboarding_step").eq("id", typeId).maybeSingle();
  if (!t || t.onboarding_step !== 2) await fail("Bu belge türü telefondan yüklenemez.");
  const file = f.get("file");
  if (!(file instanceof File) || file.size === 0) await fail("Dosya seçilmedi.");
  const up = file as File;
  if (up.size > 10 * 1024 * 1024) await fail("Dosya 10 MB'tan büyük olamaz.");
  const ext = (up.name.split(".").pop() ?? "bin").toLowerCase().replace(/[^a-z0-9]/g, "");
  const path = `${s.companyId}/employees/${me!.id}/${typeId}-${Date.now()}.${ext}`;
  const { error } = await supabase.storage.from("documents").upload(path, up, { contentType: up.type || undefined });
  if (error) await fail(error.message.includes("policy") ? "Yükleme izni yok: Supabase'de 20261030000000_self_documents.sql çalıştırılmalı." : error.message);
  const { error: e2 } = await supabase.from("employee_documents").insert({
    company_id: s.companyId, employee_id: me!.id, document_type_id: typeId, file_path: path, file_name: up.name, uploaded_by: s.userId,
  });
  if (e2) await fail(e2.message.includes("policy") ? "Kayıt izni yok: Supabase'de 20261030000000_self_documents.sql çalıştırılmalı." : e2.message);
  revalidatePath("/benim/belgeler");
  revalidatePath("/benim");
  revalidatePath("/personel/[id]/kayit", "page");
  await done("Belge yüklendi; İK'ya bildirildi.");
}
