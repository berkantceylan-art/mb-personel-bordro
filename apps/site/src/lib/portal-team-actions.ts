"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { portalContext } from "./portal";
import { createClient } from "./supabase/server";

const s = (f: FormData, k: string, max = 200) => String(f.get(k) ?? "").trim().slice(0, max);
const CODES = ["invalid_code", "already_member", "not_allowed", "rate_limited", "self"];
const code = (m: string) => CODES.find((c) => m.includes(c)) ?? "server";

async function active() {
  const ctx = await portalContext();
  if (!ctx?.account || ctx.account.status !== "active") redirect("/portal");
  return ctx;
}

/** Hesap yöneticisi: katılma kodu oluştur */
export async function createPortalInvite(form: FormData) {
  const ctx = await active();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("portal_create_invite", { p_account: ctx.account!.id, p_name: s(form, "name", 120), p_role: s(form, "role", 10) === "admin" ? "admin" : "member" });
  revalidatePath("/portal/ekip");
  redirect(error ? `/portal/ekip?hata=${code(error.message)}` : `/portal/ekip?kod=${encodeURIComponent(String(data))}`);
}

export async function deletePortalInvite(form: FormData) {
  await active();
  const supabase = await createClient();
  await supabase.from("portal_invites").delete().eq("id", s(form, "id", 40));
  revalidatePath("/portal/ekip");
  redirect("/portal/ekip");
}

export async function removePortalMember(form: FormData) {
  const ctx = await active();
  const supabase = await createClient();
  const { error } = await supabase.rpc("portal_remove_member", { p_account: ctx.account!.id, p_user: s(form, "user", 40) });
  revalidatePath("/portal/ekip");
  redirect(error ? `/portal/ekip?hata=${code(error.message)}` : "/portal/ekip");
}

/** Giriş yapmış ama hesabı olmayan kullanıcı: kodla mevcut hesaba katıl */
export async function joinPortalAccount(form: FormData) {
  const ctx = await portalContext();
  if (!ctx) redirect("/giris?sonra=/portal");
  const supabase = await createClient();
  const { error } = await supabase.rpc("portal_join", { p_code: s(form, "code", 20), p_name: s(form, "name", 120) || null });
  revalidatePath("/portal", "layout");
  if (error) (await cookies()).set("portal-katil", code(error.message), { path: "/portal", maxAge: 60 });
  redirect("/portal");
}

/** Giriş yapmış ama portal hesabı olmayan kullanıcı: kendi adına portal başvurusu (onay bekler) */
export async function registerCurrentUser(form: FormData) {
  const ctx = await portalContext();
  if (!ctx) redirect("/giris?sonra=/portal");
  if (ctx.account) redirect("/portal");
  const types = ["doctor_tr", "doctor_foreign", "clinic", "agency"];
  const type = s(form, "type", 20);
  const name = s(form, "name", 160);
  const language = s(form, "language", 2);
  if (!types.includes(type) || name.length < 2) {
    (await cookies()).set("portal-katil", "required", { path: "/portal", maxAge: 60 });
    redirect("/portal");
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("portal_register", {
    p_type: type,
    p_name: name,
    p_company: s(form, "company", 160),
    p_country: s(form, "country", 60) || "TR",
    p_city: s(form, "city", 80),
    p_phone: s(form, "phone", 40),
    p_language: ["tr", "en", "fr"].includes(language) ? language : "tr",
  });
  if (error) {
    console.error("portal başvurusu (giriş yapmış kullanıcı):", error.code, error.message);
    (await cookies()).set("portal-katil", "server", { path: "/portal", maxAge: 60 });
  }
  revalidatePath("/portal", "layout");
  redirect("/portal");
}

/** Logo: tarayıcı depoya yükler, burada hesaba işlenir ("" → kaldır) */
export async function setPortalLogo(path: string): Promise<{ ok: boolean }> {
  const ctx = await portalContext();
  if (!ctx?.account) return { ok: false };
  const supabase = await createClient();
  const { error } = await supabase.rpc("portal_update_profile", { p_account: ctx.account.id, p_logo: path, p_phone: null, p_city: null });
  revalidatePath("/portal/ekip");
  return { ok: !error };
}

// ---------------------------------------------------------------------
// Müşterilerim (aracı kuruluş / klinik)
// ---------------------------------------------------------------------
export async function savePortalClient(form: FormData) {
  const ctx = await active();
  const name = s(form, "name", 160);
  if (!name) redirect("/portal/musteriler?hata=server");
  const supabase = await createClient();
  const id = s(form, "id", 40);
  const row = { account_id: ctx.account!.id, name, country: s(form, "country", 60) || null, city: s(form, "city", 80) || null, phone: s(form, "phone", 40) || null, note: s(form, "note", 1000) || null };
  const { error } = id ? await supabase.from("portal_clients").update(row).eq("id", id) : await supabase.from("portal_clients").insert(row);
  revalidatePath("/portal/musteriler");
  redirect(error ? "/portal/musteriler?hata=server" : "/portal/musteriler");
}

export async function togglePortalClient(form: FormData) {
  await active();
  const supabase = await createClient();
  await supabase.from("portal_clients").update({ is_active: form.get("on") === "1" }).eq("id", s(form, "id", 40));
  revalidatePath("/portal/musteriler");
  redirect("/portal/musteriler");
}
