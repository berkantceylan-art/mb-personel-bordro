"use server";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

const s = (f: FormData, k: string, max = 200) => String(f.get(k) ?? "").trim().slice(0, max);

/** Anket yanıtı (giriş gerekmez) */
export async function answerSurvey(f: FormData) {
  const token = s(f, "token", 80);
  const locale = ["tr", "en", "fr"].includes(s(f, "locale", 2)) ? s(f, "locale", 2) : "tr";
  const score = Number(s(f, "score", 1));
  if (!/^[0-9a-f]{24,80}$/.test(token) || !(score >= 1 && score <= 5)) redirect(`/${locale}`);
  const supabase = await createClient();
  const { error } = await supabase.rpc("srv_answer", { p_token: token, p_score: score, p_comment: s(f, "comment", 1000) || null });
  redirect(`/${locale}/anket/${token}?s=${error ? "hata" : score <= 2 ? "dusuk" : "ok"}`);
}

/** Portal: vaka için sorun bildirimi → kalite şikâyeti */
export async function reportCaseIssue(f: FormData) {
  const caseId = s(f, "case_id", 40);
  if (!/^[0-9a-f-]{36}$/.test(caseId)) redirect("/portal");
  const supabase = await createClient();
  const { error } = await supabase.rpc("qms_portal_complaint", { p_case: caseId, p_category: s(f, "category", 20), p_description: s(f, "description", 2000) });
  redirect(`/portal/vaka/${caseId}?sorun=${error ? "hata" : "ok"}#gecmis`);
}
