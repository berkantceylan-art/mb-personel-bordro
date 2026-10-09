"use server";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import { fail } from "@/lib/flash";

/** Personel belgeyi dijital imzalar: imza PNG depoya, kayıt document_signatures + employee_documents */
export async function signDocument(f: FormData) {
  const s = await getSession();
  const key = String(f.get("key") ?? ""); const typeId = String(f.get("typeId") ?? ""); const text = String(f.get("text") ?? "");
  const dataUrl = String(f.get("signature") ?? "");
  if (!/^data:image\/png;base64,/.test(dataUrl) || String(f.get("drawn")) !== "1") await fail("İmza çizilmedi.");
  if (f.get("consent") !== "on") await fail("Okudum, kabul ediyorum kutusunu işaretleyin.");
  const supabase = await createClient();
  const { data: me } = await supabase.from("employees").select("id").eq("user_id", s.userId).maybeSingle();
  if (!me) await fail("Hesabınız bir personel kaydına bağlı değil.");
  const bytes = Buffer.from(dataUrl.split(",")[1]!, "base64");
  const path = `${s.companyId}/employees/${me!.id}/imza-${key}-${Date.now()}.png`;
  const { error: upErr } = await supabase.storage.from("documents").upload(path, bytes, { contentType: "image/png" });
  if (upErr) await fail(upErr.message.includes("policy") ? "Yükleme izni yok (20261030000000_self_documents.sql)." : upErr.message);
  const h = await headers();
  const { data: sig, error } = await supabase.from("document_signatures").insert({
    company_id: s.companyId, employee_id: me!.id, document_type_id: typeId || null, template_key: key, signature_path: path, content_text: text.slice(0, 20000),
    ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null, user_agent: h.get("user-agent")?.slice(0, 300) ?? null, created_by: s.userId,
  }).select("id").single();
  if (error) await fail(error.message.includes("document_signatures") ? "Sunucu güncellemesi gerekli (20261108000000_digital_signature.sql)." : error.message);
  if (typeId) await supabase.from("employee_documents").insert({ company_id: s.companyId, employee_id: me!.id, document_type_id: typeId, file_path: path, file_name: `Dijital imza · ${new Date().toLocaleDateString("tr-TR")}`, uploaded_by: s.userId });
  revalidatePath("/benim/imza"); revalidatePath("/benim/belgeler"); revalidatePath(`/personel/${me!.id}`);
  redirect(`/benim/imza?tamam=${encodeURIComponent("Belge imzalandı; İK'ya bildirildi.")}&son=${sig!.id}`);
}
