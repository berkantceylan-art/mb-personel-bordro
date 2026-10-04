"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { requireSiteEditor } from "./auth";
import { isLocale } from "./i18n";
import { CASE_STATUSES, PATIENT_REF_RE, portalContext } from "./portal";
import { createClient } from "./supabase/server";

const s = (f: FormData, k: string, max = 300) => String(f.get(k) ?? "").trim().slice(0, max);
const TYPES = ["doctor_tr", "doctor_foreign", "clinic", "agency"];
const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://mbdentaire.com";

// ---------------------------------------------------------------------
// Kayıt
// ---------------------------------------------------------------------
export type SignUpState = { error?: "required" | "password" | "exists" | "server" | "disabled"; sent?: boolean };

export async function portalSignUp(_prev: SignUpState, form: FormData): Promise<SignUpState> {
  const type = s(form, "type", 20);
  const name = s(form, "name", 160);
  const email = s(form, "email", 200).toLowerCase();
  const password = String(form.get("password") ?? "");
  const lang = s(form, "language", 2);
  if (!TYPES.includes(type) || name.length < 2 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error: "required" };
  if (password.length < 8) return { error: "password" };
  const portal = {
    type,
    name,
    company: s(form, "company", 160),
    country: s(form, "country", 60) || "TR",
    city: s(form, "city", 80),
    phone: s(form, "phone", 40),
    language: isLocale(lang) ? lang : "tr",
  };
  (await cookies()).set("portal-dil", portal.language, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { portal }, emailRedirectTo: `${SITE}/auth/callback?sonra=/portal` },
  });
  if (error) {
    const m = error.message.toLowerCase();
    if (m.includes("already") || m.includes("registered")) return { error: "exists" };
    if (m.includes("not allowed") || m.includes("disabled")) return { error: "disabled" };
    return { error: "server" };
  }
  // E-posta onayı kapalıysa oturum hemen açılır: hesabı hemen oluştur
  if (data.session) {
    await supabase.rpc("portal_register", {
      p_type: portal.type,
      p_name: portal.name,
      p_company: portal.company,
      p_country: portal.country,
      p_city: portal.city,
      p_phone: portal.phone,
      p_language: portal.language,
    });
    redirect("/portal");
  }
  // Var olan e-posta ile kayıt denemesinde Supabase hata vermeyip boş kimlikli kullanıcı döndürebilir
  if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) return { error: "exists" };
  return { sent: true };
}

/** E-posta onayından sonra ilk girişte: kayıtta girilen bilgilerle hesabı aç */
export async function ensurePortalAccount(): Promise<boolean> {
  const ctx = await portalContext();
  if (!ctx || ctx.account) return !!ctx?.account;
  const p = ctx.user.meta.portal as Record<string, string> | undefined;
  if (!p?.type || !p?.name) return false;
  const supabase = await createClient();
  const { error } = await supabase.rpc("portal_register", {
    p_type: p.type,
    p_name: p.name,
    p_company: p.company ?? "",
    p_country: p.country ?? "TR",
    p_city: p.city ?? "",
    p_phone: p.phone ?? "",
    p_language: p.language ?? "tr",
  });
  return !error;
}

export async function setPortalLanguage(form: FormData) {
  const lang = s(form, "language", 2);
  if (!isLocale(lang)) return;
  (await cookies()).set("portal-dil", lang, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  revalidatePath("/portal", "layout");
}

// ---------------------------------------------------------------------
// Vakalar (hekim tarafı)
// ---------------------------------------------------------------------
export type NewCaseInput = { patient_ref: string; product_slug: string; teeth: number[]; shade: string; due_date: string; notes: string };

export async function createCase(input: NewCaseInput): Promise<{ id?: string; accountId?: string; error?: "patient" | "teeth" | "server" | "inactive" }> {
  const ctx = await portalContext();
  if (!ctx?.account || ctx.account.status !== "active") return { error: "inactive" };
  const patient = String(input.patient_ref ?? "").trim();
  if (!PATIENT_REF_RE.test(patient)) return { error: "patient" };
  const teeth = [...new Set((input.teeth ?? []).map(Number))].filter((t) => Number.isInteger(t) && Math.floor(t / 10) >= 1 && Math.floor(t / 10) <= 4 && t % 10 >= 1 && t % 10 <= 8);
  const notes = String(input.notes ?? "").trim().slice(0, 4000);
  if (teeth.length === 0 && !notes) return { error: "teeth" };
  const due = /^\d{4}-\d{2}-\d{2}$/.test(input.due_date ?? "") ? input.due_date : null;
  const product = /^[a-z0-9-]{1,60}$/.test(input.product_slug ?? "") ? input.product_slug : null;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("portal_cases")
    .insert({
      account_id: ctx.account.id,
      created_by: ctx.user.id,
      patient_ref: patient,
      product_slug: product,
      teeth: teeth.sort((a, b) => a - b),
      shade: String(input.shade ?? "").trim().slice(0, 40) || null,
      due_date: due,
      notes: notes || null,
    })
    .select("id")
    .single();
  if (error || !data) return { error: "server" };
  return { id: (data as { id: string }).id, accountId: ctx.account.id };
}

export type UploadedCaseFile = { path: string; name: string; size: number; mime: string };

function validFile(f: UploadedCaseFile, accountId: string, caseId: string) {
  return (
    typeof f.path === "string" &&
    new RegExp(`^${accountId}/${caseId}/[0-9a-f-]{36}-[a-z0-9.\\-_]{1,120}$`).test(f.path) &&
    typeof f.name === "string" &&
    f.name.length <= 200
  );
}

/** Hekim, depoya yüklediği dosyaları vakaya kaydeder */
export async function registerCaseFiles(caseId: string, files: UploadedCaseFile[]): Promise<{ error?: string }> {
  const ctx = await portalContext();
  if (!ctx?.account) return { error: "inactive" };
  const supabase = await createClient();
  const { data: c } = await supabase.from("portal_cases").select("id, account_id").eq("id", caseId).maybeSingle();
  if (!c || (c as { account_id: string }).account_id !== ctx.account.id) return { error: "not_found" };
  const rows = files
    .filter((f) => validFile(f, ctx.account!.id, caseId))
    .map((f) => ({ case_id: caseId, path: f.path, name: f.name.slice(0, 200), size: Math.round(f.size) || null, mime: f.mime?.slice(0, 120) || null, from_lab: false, uploaded_by: ctx.user.id }));
  if (rows.length === 0) return {};
  const { error } = await supabase.from("portal_case_files").insert(rows);
  if (error) return { error: error.message };
  await supabase.from("portal_case_events").insert({ case_id: caseId, kind: "file", body: rows.map((r) => r.name).join(", ").slice(0, 4000), from_lab: false, author: ctx.user.id });
  revalidatePath(`/portal/vaka/${caseId}`);
  return {};
}

export async function postCaseMessage(form: FormData) {
  const ctx = await portalContext();
  const caseId = s(form, "case_id", 40);
  const body = s(form, "body", 4000);
  if (!ctx?.account || !body || !/^[0-9a-f-]{36}$/.test(caseId)) redirect(`/portal/vaka/${caseId}`);
  const supabase = await createClient();
  await supabase.from("portal_case_events").insert({ case_id: caseId, kind: "message", body, from_lab: false, author: ctx!.user.id });
  revalidatePath(`/portal/vaka/${caseId}`);
  redirect(`/portal/vaka/${caseId}#gecmis`);
}

export async function portalSignOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/giris");
}

// ---------------------------------------------------------------------
// Laboratuvar tarafı (admin)
// ---------------------------------------------------------------------
export async function setAccountStatus(form: FormData) {
  const u = await requireSiteEditor();
  const id = s(form, "id", 40);
  const status = s(form, "status", 20);
  if (!["pending", "active", "suspended"].includes(status)) redirect("/admin/portal");
  const supabase = await createClient();
  const patch: Record<string, unknown> = { status };
  if (status === "active") Object.assign(patch, { approved_at: new Date().toISOString(), approved_by: u.id });
  const { error } = await supabase.from("portal_accounts").update(patch).eq("id", id);
  revalidatePath("/admin", "layout");
  const msg = error ? `hata=${encodeURIComponent(error.message)}` : `ok=${encodeURIComponent(status === "active" ? "Hesap onaylandı." : status === "suspended" ? "Hesap askıya alındı." : "Hesap beklemeye alındı.")}`;
  redirect(`/admin/portal/hesap/${id}?${msg}`);
}

export async function saveAccountNote(form: FormData) {
  await requireSiteEditor();
  const id = s(form, "id", 40);
  const lang = s(form, "language", 2);
  const supabase = await createClient();
  await supabase
    .from("portal_accounts")
    .update({ note: s(form, "note", 2000) || null, ...(isLocale(lang) ? { language: lang } : {}) })
    .eq("id", id);
  redirect(`/admin/portal/hesap/${id}?ok=${encodeURIComponent("Kaydedildi.")}`);
}

export async function labUpdateCase(form: FormData) {
  const u = await requireSiteEditor();
  const id = s(form, "id", 40);
  const status = s(form, "status", 20);
  const message = s(form, "message", 4000);
  const tracking = s(form, "tracking", 120);
  const supabase = await createClient();
  const patch: Record<string, unknown> = { tracking: tracking || null };
  if (CASE_STATUSES.includes(status as never)) patch.status = status;
  const { error } = await supabase.from("portal_cases").update(patch).eq("id", id);
  if (!error && message) await supabase.from("portal_case_events").insert({ case_id: id, kind: "message", body: message, from_lab: true, author: u.id });
  revalidatePath(`/admin/portal/vaka/${id}`);
  revalidatePath(`/portal/vaka/${id}`);
  redirect(`/admin/portal/vaka/${id}?${error ? `hata=${encodeURIComponent(error.message)}` : `ok=${encodeURIComponent("Vaka güncellendi.")}`}`);
}

export async function registerLabFiles(caseId: string, accountId: string, files: UploadedCaseFile[]): Promise<{ error?: string }> {
  const u = await requireSiteEditor();
  const rows = files
    .filter((f) => validFile(f, accountId, caseId))
    .map((f) => ({ case_id: caseId, path: f.path, name: f.name.slice(0, 200), size: Math.round(f.size) || null, mime: f.mime?.slice(0, 120) || null, from_lab: true, uploaded_by: u.id }));
  if (rows.length === 0) return {};
  const supabase = await createClient();
  const { error } = await supabase.from("portal_case_files").insert(rows);
  if (error) return { error: error.message };
  await supabase.from("portal_case_events").insert({ case_id: caseId, kind: "file", body: rows.map((r) => r.name).join(", ").slice(0, 4000), from_lab: true, author: u.id });
  revalidatePath(`/admin/portal/vaka/${caseId}`);
  return {};
}
