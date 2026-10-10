"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requestOrigin } from "./origin";
import { portalContext } from "./portal";
import { createClient } from "./supabase/server";

const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const back = (q: string, anchor: string) => redirect(`/portal/profil?${q}#${anchor}`);

const ACCOUNT_FIELDS = ["name", "company", "country", "city", "phone", "website", "instagram", "whatsapp", "contact_email", "address", "district", "postal_code", "delivery_address", "delivery_note", "working_hours", "invoice_title", "tax_office", "tax_no", "invoice_address", "shade_system", "preferred_carrier", "about"];

/** Kurum bilgileri (yalnız hesap yöneticisi; formda bulunan alanlar güncellenir) */
export async function saveAccountProfile(form: FormData) {
  const ctx = await portalContext();
  if (!ctx?.account) redirect("/portal");
  const section = s(form, "section") || "kurum";
  const p: Record<string, unknown> = {};
  for (const f of ACCOUNT_FIELDS) if (form.has(f)) p[f] = s(form, f);
  if (form.has("e_invoice_present")) p.e_invoice = form.get("e_invoice") === "on";
  const supabase = await createClient();
  const { error } = await supabase.rpc("portal_update_account", { p_account: ctx.account.id, p });
  if (error) {
    console.error("portal profil:", error.message);
    back(`hata=${error.message.includes("not_allowed") ? "not_allowed" : error.message.includes("name_required") ? "name_required" : "server"}`, section);
  }
  revalidatePath("/portal", "layout");
  back(`ok=${section}`, section);
}

/** Kişinin kendi bilgileri */
export async function saveMyProfile(form: FormData) {
  const ctx = await portalContext();
  if (!ctx) redirect("/giris?sonra=/portal/profil");
  const supabase = await createClient();
  const { error } = await supabase.rpc("portal_update_my_profile", {
    p: { display_name: s(form, "display_name"), title: s(form, "title"), specialty: s(form, "specialty"), phone: s(form, "phone"), chamber_no: s(form, "chamber_no") },
  });
  if (error) back("hata=server", "kisisel");
  revalidatePath("/portal", "layout");
  back("ok=kisisel", "kisisel");
}

/** Giriş e-postası: Supabase yeni adrese onay bağlantısı gönderir */
export async function changeLoginEmail(form: FormData) {
  const ctx = await portalContext();
  if (!ctx) redirect("/giris?sonra=/portal/profil");
  const email = s(form, "email").toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) back("hata=email", "giris");
  if (email === ctx.user.email.toLowerCase()) back("hata=same", "giris");
  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ email }, { emailRedirectTo: `${await requestOrigin()}/auth/callback?sonra=/portal/profil` });
  if (error) {
    console.error("e-posta değişikliği:", error.code, error.message);
    const m = `${error.code ?? ""} ${error.message}`.toLowerCase();
    back(`hata=${m.includes("exists") || m.includes("already") ? "exists" : m.includes("rate") ? "rate" : "server"}`, "giris");
  }
  back("ok=eposta", "giris");
}

/** Şifre: önce mevcut şifre doğrulanır */
export async function changeLoginPassword(form: FormData) {
  const ctx = await portalContext();
  if (!ctx) redirect("/giris?sonra=/portal/profil");
  const current = String(form.get("current") ?? "");
  const next = String(form.get("next") ?? "");
  if (next.length < 8) back("hata=short", "giris");
  if (next !== String(form.get("repeat") ?? "")) back("hata=mismatch", "giris");
  const supabase = await createClient();
  const { error: authError } = await supabase.auth.signInWithPassword({ email: ctx.user.email, password: current });
  if (authError) back(`hata=${authError.message.toLowerCase().includes("rate") ? "rate" : "wrong"}`, "giris");
  const { error } = await supabase.auth.updateUser({ password: next });
  if (error) {
    const m = `${error.code ?? ""} ${error.message}`.toLowerCase();
    back(`hata=${m.includes("weak") || m.includes("pwned") ? "weak" : m.includes("same") ? "mismatch" : "server"}`, "giris");
  }
  back("ok=sifre", "giris");
}
