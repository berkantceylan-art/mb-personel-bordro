"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { portalContext } from "@/lib/portal";
import { createClient } from "@/lib/supabase/server";

const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

/** Teslim edilen vakayı puanla */
export async function rateCase(f: FormData) {
  const id = s(f, "case_id");
  const n = (k: string) => Math.min(5, Math.max(1, Number(s(f, k)) || 0));
  const supabase = await createClient();
  const { error } = await supabase.rpc("portal_rate_case", { p_case: id, p_fit: n("fit"), p_shade: n("shade"), p_service: n("service"), p_comment: s(f, "comment").slice(0, 1000) || null });
  revalidatePath(`/portal/vaka/${id}`);
  redirect(`/portal/vaka/${id}?puan=${error ? "hata" : "ok"}#puan`);
}

/** Vakanın reçetesini şablon olarak kaydet */
export async function saveTemplate(f: FormData) {
  const ctx = await portalContext();
  const id = s(f, "case_id");
  if (!ctx?.account) redirect("/portal");
  const supabase = await createClient();
  const { data: c } = await supabase.from("portal_cases").select("product_slug, shade, notes").eq("id", id).maybeSingle();
  const { error } = await supabase.from("portal_case_templates").insert({ account_id: ctx.account.id, name: s(f, "name").slice(0, 80) || "Şablon", product_slug: c?.product_slug ?? null, shade: c?.shade ?? null, notes: c?.notes ?? null });
  redirect(`/portal/vaka/${id}?sablon=${error ? "hata" : "ok"}`);
}

export async function deleteTemplate(f: FormData) {
  const supabase = await createClient();
  await supabase.from("portal_case_templates").delete().eq("id", s(f, "id"));
  revalidatePath("/portal/vaka/yeni");
}

/** Bildirim tercihleri (hesap yöneticisi) */
export async function saveNotifyPrefs(f: FormData) {
  const ctx = await portalContext();
  if (!ctx?.account) redirect("/portal");
  const supabase = await createClient();
  await supabase.from("portal_accounts").update({ notify_email: f.get("notify_email") === "on", notify_whatsapp: f.get("notify_whatsapp") === "on" }).eq("id", ctx.account.id);
  revalidatePath("/portal/profil");
  redirect("/portal/profil?bildirim=ok");
}
