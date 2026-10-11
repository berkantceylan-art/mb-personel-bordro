"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import { done, fail } from "@/lib/flash";
import { parseAmount } from "@/lib/fin";

const str = (f: FormData, k: string, max = 400) => String(f.get(k) ?? "").trim().slice(0, max);
const opt = (f: FormData, k: string, max = 400) => str(f, k, max) || null;
const err = (m: string) => (/permission|policy|not_allowed/.test(m) ? "Müşteri takibi için satış (giriş) yetkisi gerekir." : /crm_|schema cache/.test(m) ? "Supabase'de 20261227000000_quality_crm.sql çalıştırılmalı." : m);

async function need() {
  const s = await getSession();
  if ((s.modules.sales ?? 0) < 2 && (s.modules.lab ?? 0) < 3) await fail(err("not_allowed"));
  return s;
}
const reval = () => revalidatePath("/crm");

export async function saveLead(f: FormData) {
  await need();
  const id = str(f, "id", 40);
  const row = {
    name: str(f, "name", 160), contact_name: opt(f, "contact_name", 120), phone: opt(f, "phone", 40), email: opt(f, "email", 200), city: opt(f, "city", 80),
    country: str(f, "country", 60) || "TR", source: str(f, "source", 20) || "other", stage: str(f, "stage", 20) || "new",
    est_monthly: parseAmount(str(f, "est_monthly", 20)), next_action: opt(f, "next_action", 200), next_date: opt(f, "next_date", 10),
    lost_reason: opt(f, "lost_reason", 300), note: opt(f, "note", 2000), ...(f.has("owner_id") ? { owner_id: opt(f, "owner_id", 40) } : {}),
  };
  if (!row.name) await fail("Ad yazın.");
  const supabase = await createClient();
  const res = id ? await supabase.from("crm_leads").update(row).eq("id", id).select("id").single() : await supabase.from("crm_leads").insert(row).select("id").single();
  if (res.error) await fail(err(res.error.message));
  reval();
  if (!id) redirect(`/crm?aday=${res.data!.id}`);
  await done("Kaydedildi.");
}

export async function setLeadStage(f: FormData) {
  await need();
  const supabase = await createClient();
  const { error } = await supabase.from("crm_leads").update({ stage: str(f, "stage", 20) }).eq("id", str(f, "id", 40));
  if (error) await fail(err(error.message));
  reval();
}

export async function addActivity(f: FormData) {
  await need();
  const lead = opt(f, "lead_id", 40), customer = opt(f, "customer_id", 40);
  const kind = str(f, "kind", 20) || "call";
  const due = opt(f, "due_date", 10);
  const supabase = await createClient();
  const { error } = await supabase.from("crm_activities").insert({ lead_id: lead, customer_id: customer, kind, notes: opt(f, "notes", 2000), due_date: due, done: kind !== "task" });
  if (error) await fail(err(error.message));
  if (lead) {
    const next = opt(f, "next_action", 200);
    const upd: Record<string, unknown> = {};
    if (next || due) { upd.next_action = next ?? (kind === "task" ? opt(f, "notes", 200) : null); upd.next_date = due; }
    const { data: l } = await supabase.from("crm_leads").select("stage").eq("id", lead).maybeSingle();
    if (l?.stage === "new" && ["call", "visit", "whatsapp", "email"].includes(kind)) upd.stage = "contacted";
    if (kind === "sample" && ["new", "contacted"].includes(String(l?.stage))) upd.stage = "sample";
    if (kind === "offer" && ["new", "contacted", "sample"].includes(String(l?.stage))) upd.stage = "offer";
    if (Object.keys(upd).length) await supabase.from("crm_leads").update(upd).eq("id", lead);
  }
  reval();
  if (customer) revalidatePath(`/isler/hekimler/${customer}`);
}

export async function completeTask(f: FormData) {
  await need();
  const supabase = await createClient();
  const { error } = await supabase.from("crm_activities").update({ done: true, at: new Date().toISOString() }).eq("id", str(f, "id", 40));
  if (error) await fail(err(error.message));
  reval();
}

export async function convertLead(f: FormData) {
  await need();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("crm_lead_convert", { p_lead: str(f, "id", 40), p_kind: str(f, "kind", 20) || "doctor_tr", p_currency: str(f, "currency", 3) || "TRY" });
  if (error) await fail(err(error.message));
  reval();
  redirect(`/isler/hekimler/${data}`);
}

export async function leadFromMessage(f: FormData) {
  await need();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("crm_lead_from_message", { p_message: str(f, "id", 40) });
  if (error) await fail(err(error.message));
  reval();
  redirect(`/crm?aday=${data}`);
}

/** Hacmi düşen klinik için geri kazanma görevi */
export async function winbackTask(f: FormData) {
  await need();
  const supabase = await createClient();
  const tomorrow = new Date(Date.now() + 27 * 3600 * 1000).toISOString().slice(0, 10);
  const { error } = await supabase.from("crm_activities").insert({ customer_id: str(f, "customer_id", 40), kind: "task", notes: `Geri kazanma: ${str(f, "why", 200)}`, due_date: tomorrow, done: false });
  if (error) await fail(err(error.message));
  reval();
  await done("Görev yarın için eklendi.");
}
