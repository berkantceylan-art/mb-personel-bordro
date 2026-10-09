"use server";
import { revalidatePath } from "next/cache";
import { done, fail } from "@/lib/flash";
import { PROBATION_CRITERIA } from "@/lib/onboarding";
import { getSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

const STAFF = ["owner", "accountant", "hr", "branch_manager"];
const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const missing = (m: string) => (m.includes("onboarding") ? "Supabase'de 20261111000000_onboarding.sql çalıştırılmalı." : m);

export async function startOnboarding(f: FormData) {
  const s = await getSession();
  if (!STAFF.includes(s.role)) await fail("Yetkiniz yok.");
  const supabase = await createClient();
  const { error } = await supabase.rpc("start_onboarding", { p_employee: str(f, "employee_id"), p_mentor: str(f, "mentor") || null });
  if (error) await fail(missing(error.message));
  revalidatePath("/uyum");
  await done("Uyum süreci başlatıldı; kontrol listesi oluşturuldu.");
}

export async function toggleTask(f: FormData) {
  await getSession();
  const supabase = await createClient();
  const { error } = await supabase.rpc("toggle_onboarding_task", { p_task: str(f, "id"), p_done: str(f, "done") === "1", p_note: str(f, "note") || null });
  if (error) await fail(missing(error.message));
  revalidatePath("/uyum");
  revalidatePath("/benim/ilk-gunlerim");
}

export async function saveOnboarding(f: FormData) {
  const s = await getSession();
  if (!STAFF.includes(s.role)) await fail("Yetkiniz yok.");
  const supabase = await createClient();
  const scores = Object.fromEntries(PROBATION_CRITERIA.map(([k]) => [k, Number(f.get(k)) || null]).filter(([, v]) => v));
  const decision = str(f, "decision");
  const row: Record<string, unknown> = {
    mentor_employee_id: str(f, "mentor") || null,
    probation_end: str(f, "probation_end") || null,
    welcome_note: str(f, "welcome_note") || null,
    eval_scores: Object.keys(scores).length ? scores : null,
    decision_note: str(f, "decision_note") || null,
  };
  if (decision === "continue" || decision === "terminate") Object.assign(row, { probation_decision: decision, decided_by: s.userId, decided_at: new Date().toISOString() });
  const { error } = await supabase.from("employee_onboarding").update(row).eq("employee_id", str(f, "employee_id"));
  if (error) await fail(missing(error.message));
  revalidatePath(`/uyum/${str(f, "employee_id")}`);
  await done(decision === "terminate" ? "Karar kaydedildi. Deneme süresi içinde fesih için İşten çıkış sihirbazını kullanın (bildirimsiz, tazminatsız; kod 04 değil, deneme süresi)." : "Kaydedildi.");
}

export async function addItem(f: FormData) {
  const s = await getSession();
  if (!["owner", "hr"].includes(s.role)) await fail("Yetkiniz yok.");
  const supabase = await createClient();
  // Şirketin kendi listesi yoksa önce varsayılanları kopyala, sonra ekle
  const { count } = await supabase.from("onboarding_items").select("id", { count: "exact", head: true }).eq("company_id", s.companyId);
  if (!count) {
    const { data: defs } = await supabase.from("onboarding_items").select("phase, title, description, owner, sort").is("company_id", null);
    if (defs?.length) await supabase.from("onboarding_items").insert(defs.map((d) => ({ ...d, company_id: s.companyId })));
  }
  if (str(f, "title")) {
    const { error } = await supabase.from("onboarding_items").insert({ company_id: s.companyId, phase: str(f, "phase"), title: str(f, "title"), owner: str(f, "owner") || "hr", sort: 200 });
    if (error) await fail(missing(error.message));
  }
  revalidatePath("/uyum");
  await done("Kontrol listesi şablonu güncellendi (yeni başlatılan süreçlere uygulanır).");
}

export async function removeItem(f: FormData) {
  const s = await getSession();
  if (!["owner", "hr"].includes(s.role)) await fail("Yetkiniz yok.");
  const supabase = await createClient();
  await supabase.from("onboarding_items").update({ active: false }).eq("id", str(f, "id")).eq("company_id", s.companyId);
  revalidatePath("/uyum");
}
