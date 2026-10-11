"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import { done, fail } from "@/lib/flash";
import { parseAmount } from "@/lib/fin";
import { AUDIT_TEMPLATE } from "@/lib/quality";

const str = (f: FormData, k: string, max = 400) => String(f.get(k) ?? "").trim().slice(0, max);
const opt = (f: FormData, k: string, max = 400) => str(f, k, max) || null;
const ID = /^[0-9a-f-]{36}$/;
const err = (m: string) => (/permission|policy|not_allowed/.test(m) ? "Kalite kaydı için laboratuvar ya da üretim (giriş) yetkisi gerekir." : /qms_|srv_|schema cache/.test(m) ? "Supabase'de 20261227000000_quality_crm.sql çalıştırılmalı." : m);

async function need() {
  const s = await getSession();
  if ((s.modules.production ?? 0) < 2 && (s.modules.lab ?? 0) < 2) await fail(err("not_allowed"));
  return s;
}

export async function saveComplaint(f: FormData) {
  await need();
  const id = str(f, "id", 40);
  const supabase = await createClient();
  let jobId: string | null = null;
  const jobNo = Number(str(f, "job_no", 12).replace(/\D/g, ""));
  let customer = opt(f, "customer_id", 40);
  if (jobNo) {
    const { data: j } = await supabase.from("jobs").select("id, customer_id").eq("no", jobNo).maybeSingle();
    if (!j) await fail(`İş #${jobNo} bulunamadı.`);
    jobId = j!.id; customer = customer ?? (j!.customer_id as string | null);
  }
  const row: Record<string, unknown> = {
    category: str(f, "category", 20) || "other", severity: str(f, "severity", 10) || "medium", source: str(f, "source", 20) || "phone",
    description: str(f, "description", 2000),
  };
  if (customer) row.customer_id = customer;
  if (jobNo) row.job_id = jobId;
  if (id) {
    for (const k of ["root_cause", "resolution"]) row[k] = opt(f, k, 2000);
    row.status = str(f, "status", 20) || "open";
    row.remake = f.get("remake") === "on";
    row.cost = parseAmount(str(f, "cost", 20)) ?? 0;
    row.closed_at = row.status === "closed" ? new Date().toISOString() : null;
    if (!row.description) delete row.description;
  } else if (!row.description) await fail("Şikâyeti yazın.");
  const res = id ? await supabase.from("qms_complaints").update(row).eq("id", id).select("id").single() : await supabase.from("qms_complaints").insert(row).select("id").single();
  if (res.error) await fail(err(res.error.message));
  revalidatePath("/kalite");
  if (!id) redirect(`/kalite?sikayet=${res.data!.id}`);
  await done("Kaydedildi.");
}

export async function openNcr(f: FormData) {
  await need();
  const supabase = await createClient();
  const complaint = opt(f, "complaint_id", 40);
  const { data, error } = await supabase.from("qms_ncrs").insert({
    source: complaint ? "complaint" : str(f, "source", 20) || "internal", complaint_id: complaint, title: str(f, "title", 200) || "Uygunsuzluk",
    description: opt(f, "description", 2000), item_id: opt(f, "item_id", 40), lot_no: opt(f, "lot_no", 60),
  }).select("id").single();
  if (error) await fail(err(error.message));
  revalidatePath("/kalite", "layout");
  redirect(`/kalite/uygunsuzluk?id=${data!.id}`);
}

export async function saveNcr(f: FormData) {
  await need();
  const id = str(f, "id", 40);
  const supabase = await createClient();
  const status = str(f, "status", 20);
  const { error } = await supabase.from("qms_ncrs").update({
    title: str(f, "title", 200), description: opt(f, "description", 2000), immediate_action: opt(f, "immediate_action", 1000), root_cause: opt(f, "root_cause", 2000),
    status, effective: status === "closed" ? f.get("effective") === "on" : null, closed_at: status === "closed" ? new Date().toISOString() : null,
  }).eq("id", id);
  if (error) await fail(err(error.message));
  revalidatePath("/kalite", "layout");
  await done("Kaydedildi.");
}

export async function addAction(f: FormData) {
  await need();
  const supabase = await createClient();
  const { error } = await supabase.from("qms_actions").insert({ ncr_id: str(f, "ncr_id", 40), kind: str(f, "kind", 20) || "corrective", description: str(f, "description", 1000), owner_id: opt(f, "owner_id", 40), due_date: opt(f, "due_date", 10) });
  if (error) await fail(err(error.message));
  await supabase.from("qms_ncrs").update({ status: "action" }).eq("id", str(f, "ncr_id", 40)).eq("status", "open");
  revalidatePath("/kalite", "layout");
}

export async function toggleAction(f: FormData) {
  await need();
  const supabase = await createClient();
  const doneNow = str(f, "done", 2) === "1";
  const { error } = await supabase.from("qms_actions").update({ done_at: doneNow ? new Date().toISOString() : null, done_note: opt(f, "done_note", 500) }).eq("id", str(f, "id", 40));
  if (error) await fail(err(error.message));
  revalidatePath("/kalite", "layout");
}

export async function createAudit(f: FormData) {
  await need();
  const supabase = await createClient();
  const { data, error } = await supabase.from("qms_audits").insert({ title: str(f, "title", 160) || "İç denetim", auditor: opt(f, "auditor", 120), audit_date: opt(f, "audit_date", 10) ?? undefined, items: AUDIT_TEMPLATE.map((t) => ({ text: t, result: null, note: "" })) }).select("id").single();
  if (error) await fail(err(error.message));
  redirect(`/kalite/denetim?id=${data!.id}`);
}

export async function saveAudit(f: FormData) {
  await need();
  const id = str(f, "id", 40);
  const n = Number(str(f, "n", 4));
  const items = Array.from({ length: Math.min(200, n) }, (_, i) => ({ text: str(f, `t${i}`, 300), result: ["ok", "nok", "na"].includes(str(f, `r${i}`, 3)) ? str(f, `r${i}`, 3) : null, note: str(f, `n${i}`, 300) })).filter((x) => x.text);
  const extra = str(f, "new_item", 300);
  if (extra) items.push({ text: extra, result: null, note: "" });
  const supabase = await createClient();
  const { error } = await supabase.from("qms_audits").update({ items, summary: opt(f, "summary", 2000), status: str(f, "status", 10) === "done" ? "done" : "draft" }).eq("id", id);
  if (error) await fail(err(error.message));
  revalidatePath("/kalite/denetim");
  await done("Denetim kaydedildi.");
}

// ---------------------------------------------------------------------
// Anket
// ---------------------------------------------------------------------
export async function saveSurveySettings(f: FormData) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("srv_settings_save", { p_enabled: f.get("enabled") === "on", p_delay: Number(str(f, "delay", 3)) || 3, p_between: Number(str(f, "between", 4)) || 14 });
  if (error) await fail(/not_allowed/.test(error.message) ? "Anket ayarı için tam yetki gerekir." : err(error.message));
  revalidatePath("/kalite/anket");
  await done("Anket ayarları kaydedildi.");
}

/** WhatsApp'a yönlendirir ve anketi gönderildi işaretler */
export async function sendSurvey(f: FormData) {
  const id = str(f, "id", 40);
  const url = str(f, "url", 1500);
  if (!ID.test(id) || !url.startsWith("https://wa.me/")) await fail("Telefon numarası yok.");
  const supabase = await createClient();
  await supabase.rpc("srv_mark_sent", { p_ids: [id] });
  revalidatePath("/kalite/anket");
  redirect(url);
}

export async function markSurveysSent(f: FormData) {
  const ids = f.getAll("id").map(String).filter((x) => ID.test(x));
  const supabase = await createClient();
  const { error } = await supabase.rpc("srv_mark_sent", { p_ids: ids });
  if (error) await fail(err(error.message));
  revalidatePath("/kalite/anket");
}
