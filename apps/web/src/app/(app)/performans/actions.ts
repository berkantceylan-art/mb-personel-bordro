"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { done, fail } from "@/lib/flash";
import { average, type Criterion } from "@/lib/performance";
import { getSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

const HR = ["owner", "accountant", "hr"];
const STAFF = [...HR, "branch_manager"];
const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const missing = (m: string) => (m.includes("review") || m.includes("skills") || m.includes("goals") ? "Supabase'de 20261112000000_performance.sql çalıştırılmalı." : m);

/** Yeni değerlendirme dönemi: dönem sonunda çalışan herkes için değerlendirme açılır */
export async function createCycle(f: FormData) {
  const s = await getSession();
  if (!HR.includes(s.role)) await fail("Yetkiniz yok.");
  const start = str(f, "period_start"); const end = str(f, "period_end");
  if (!str(f, "name") || !/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || end < start) await fail("Ad ve geçerli bir dönem aralığı girin.");
  const supabase = await createClient();
  const { data: c, error } = await supabase.from("review_cycles").insert({ company_id: s.companyId, name: str(f, "name"), period_start: start, period_end: end, due_on: str(f, "due_on") || null, self_eval: f.get("self_eval") === "on" }).select("id").single();
  if (error || !c) await fail(missing(error?.message ?? "Oluşturulamadı"));
  const { data: emps } = await supabase.from("employees").select("id, hire_date").neq("status", "terminated").lte("hire_date", end);
  // En az 1 ay çalışmış olanlar değerlendirilir
  const min = new Date(Date.parse(end) - 30 * 86_400_000).toISOString().slice(0, 10);
  const rows = (emps ?? []).filter((e) => e.hire_date && e.hire_date <= min).map((e) => ({ company_id: s.companyId, cycle_id: c!.id, employee_id: e.id }));
  for (let i = 0; i < rows.length; i += 200) await supabase.from("reviews").insert(rows.slice(i, i + 200));
  revalidatePath("/performans");
  redirect(`/performans/${c!.id}`);
}

export async function setCycleStatus(f: FormData) {
  const s = await getSession();
  if (!HR.includes(s.role)) await fail("Yetkiniz yok.");
  const supabase = await createClient();
  await supabase.from("review_cycles").update({ status: str(f, "status") === "closed" ? "closed" : "open" }).eq("id", str(f, "id"));
  revalidatePath(`/performans/${str(f, "id")}`);
  await done(str(f, "status") === "closed" ? "Dönem kapatıldı." : "Dönem yeniden açıldı.");
}

/** Şef değerlendirmesi; "paylaş" ile personel sonucu görür */
export async function saveReview(f: FormData) {
  const s = await getSession();
  if (!STAFF.includes(s.role)) await fail("Yetkiniz yok.");
  const supabase = await createClient();
  const id = str(f, "id");
  const { data: r } = await supabase.from("reviews").select("cycle_id, employee_id, review_cycles(criteria)").eq("id", id).maybeSingle();
  if (!r) await fail("Değerlendirme bulunamadı.");
  const criteria = ((r!.review_cycles as unknown as { criteria: Criterion[] } | null)?.criteria ?? []) as Criterion[];
  const scores = Object.fromEntries(criteria.map((c) => [c.key, Number(f.get(c.key))]).filter(([, v]) => Number(v) >= 1 && Number(v) <= 5));
  const overall = average(scores, criteria);
  const raise = str(f, "raise_pct").replace(",", ".");
  const share = f.get("share") === "1";
  if (share && Object.keys(scores).length < criteria.length) await fail("Paylaşmadan önce tüm ölçütleri puanlayın.");
  const { error } = await supabase.from("reviews").update({
    mgr_scores: scores, mgr_comment: str(f, "mgr_comment") || null, strengths: str(f, "strengths") || null, improvements: str(f, "improvements") || null,
    overall, raise_pct: raise ? Number(raise) : null, reviewer: s.userId, mgr_submitted_at: new Date().toISOString(),
    ...(share ? { shared_at: new Date().toISOString() } : {}),
  }).eq("id", id);
  if (error) await fail(missing(error.message));
  revalidatePath(`/performans/${r!.cycle_id}`);
  await done(share ? "Değerlendirme kaydedildi ve personelle paylaşıldı." : "Değerlendirme kaydedildi (henüz paylaşılmadı).");
}

/* ------------------------------------------------------------------ Yetkinlik ve hedefler */
export async function saveSkills(f: FormData) {
  const s = await getSession();
  if (!STAFF.includes(s.role)) await fail("Yetkiniz yok.");
  const supabase = await createClient();
  const employeeId = str(f, "employee_id");
  const rows: Array<Record<string, unknown>> = [];
  const del: string[] = [];
  for (const [k, v] of f.entries()) {
    if (!k.startsWith("lvl_")) continue;
    const skill = k.slice(4);
    const lvl = String(v);
    const tgt = String(f.get(`tgt_${skill}`) ?? "");
    if (lvl === "") { del.push(skill); continue; }
    rows.push({ employee_id: employeeId, skill_id: skill, company_id: s.companyId, level: Number(lvl), target_level: tgt === "" ? null : Number(tgt), assessed_by: s.userId, assessed_at: new Date().toISOString() });
  }
  if (rows.length) { const { error } = await supabase.from("employee_skills").upsert(rows, { onConflict: "employee_id,skill_id" }); if (error) await fail(missing(error.message)); }
  if (del.length) await supabase.from("employee_skills").delete().eq("employee_id", employeeId).in("skill_id", del);
  revalidatePath("/yetkinlik");
  await done("Beceri seviyeleri kaydedildi.");
}

export async function addSkill(f: FormData) {
  const s = await getSession();
  if (!["owner", "hr"].includes(s.role)) await fail("Yetkiniz yok.");
  if (!str(f, "name")) await fail("Beceri adı yazın.");
  const supabase = await createClient();
  const { error } = await supabase.from("skills").insert({ company_id: s.companyId, name: str(f, "name"), category: str(f, "category") || "Genel", sort: 500 });
  if (error) await fail(missing(error.message));
  revalidatePath("/yetkinlik");
  await done("Beceri eklendi.");
}

export async function saveGoal(f: FormData) {
  const s = await getSession();
  if (!STAFF.includes(s.role)) await fail("Yetkiniz yok.");
  const supabase = await createClient();
  const id = str(f, "id");
  const row = { company_id: s.companyId, employee_id: str(f, "employee_id") || null, department_id: str(f, "department_id") || null, title: str(f, "title"), description: str(f, "description") || null, due_on: str(f, "due_on") || null, progress: Math.max(0, Math.min(100, Number(str(f, "progress")) || 0)), status: ["open", "done", "cancelled"].includes(str(f, "status")) ? str(f, "status") : "open", updated_at: new Date().toISOString() };
  if (!row.title) await fail("Hedef başlığı yazın.");
  const { error } = id ? await supabase.from("goals").update(row).eq("id", id) : await supabase.from("goals").insert(row);
  if (error) await fail(missing(error.message));
  revalidatePath("/yetkinlik");
  await done("Hedef kaydedildi.");
}

/* ------------------------------------------------------------------ Personel (self) */
export async function submitSelfReview(f: FormData) {
  await getSession();
  const supabase = await createClient();
  const keys = String(f.get("keys") ?? "").split(",").filter(Boolean);
  const scores = Object.fromEntries(keys.map((k) => [k, Number(f.get(k))]).filter(([, v]) => Number(v) >= 1 && Number(v) <= 5));
  if (Object.keys(scores).length < keys.length) await fail("Her ölçüt için bir puan seçin.");
  const { error } = await supabase.rpc("submit_self_review", { p_review: str(f, "id"), p_scores: scores, p_comment: str(f, "comment") });
  if (error) await fail(missing(error.message));
  revalidatePath("/benim/performans");
  await done("Öz değerlendirmeniz gönderildi.");
}

export async function acknowledgeReview(f: FormData) {
  await getSession();
  const supabase = await createClient();
  const { error } = await supabase.rpc("acknowledge_review", { p_review: str(f, "id"), p_note: str(f, "note") });
  if (error) await fail(missing(error.message));
  revalidatePath("/benim/performans");
  await done("Değerlendirmenizi okuduğunuzu bildirdiniz.");
}

export async function updateMyGoal(f: FormData) {
  await getSession();
  const supabase = await createClient();
  const { error } = await supabase.rpc("update_my_goal", { p_goal: str(f, "id"), p_progress: Number(str(f, "progress")) || 0, p_note: str(f, "note") });
  if (error) await fail(missing(error.message));
  revalidatePath("/benim/hedefler");
  await done("İlerleme güncellendi.");
}
