"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { parseTL } from "@mb/core";
import { done, fail } from "@/lib/flash";
import { CRITERIA, STAGE_LABEL, normalizePhone, slugify } from "@/lib/recruiting";
import { getSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

const HR = ["owner", "accountant", "hr"];
const STAFF = [...HR, "branch_manager"];
const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const missing = (m: string) => m.includes("job_postings") || m.includes("candidates") ? "Supabase'de 20261110000000_recruiting.sql çalıştırılmalı." : m;

/* ------------------------------------------------------------------ İlanlar */
export async function savePosting(f: FormData) {
  const s = await getSession();
  if (!HR.includes(s.role)) await fail("Yetkiniz yok.");
  const title = str(f, "title");
  if (!title) await fail("İlan başlığı zorunlu.");
  let bonus: number | null = null;
  try { bonus = str(f, "referral_bonus") ? parseTL(str(f, "referral_bonus")) : null; } catch { await fail("Tavsiye primi okunamadı."); }
  const row = {
    company_id: s.companyId, title,
    department_id: str(f, "department_id") || null,
    description: str(f, "description") || null,
    requirements: str(f, "requirements") || null,
    employment_type: str(f, "employment_type") || "Tam zamanlı",
    experience: str(f, "experience") || null,
    location: str(f, "location") || null,
    headcount: Math.max(1, Number(str(f, "headcount")) || 1),
    referral_bonus: bonus,
    status: ["draft", "open", "closed"].includes(str(f, "status")) ? str(f, "status") : "open",
    closes_on: str(f, "closes_on") || null,
    updated_at: new Date().toISOString(),
  };
  const supabase = await createClient();
  const id = str(f, "id");
  if (id) {
    const { error } = await supabase.from("job_postings").update(row).eq("id", id);
    if (error) await fail(missing(error.message));
  } else {
    const base = slugify(title);
    const { data: taken } = await supabase.from("job_postings").select("slug").like("slug", `${base}%`);
    const set = new Set((taken ?? []).map((t) => t.slug));
    let slug = base; for (let i = 2; set.has(slug); i++) slug = `${base}-${i}`;
    const { error } = await supabase.from("job_postings").insert({ ...row, slug });
    if (error) await fail(missing(error.message));
  }
  revalidatePath("/ise-alim");
  await done(id ? "İlan güncellendi." : "İlan yayınlandı; kariyer sayfasında görünür.");
}

/* ------------------------------------------------------------------ Adaylar */
export async function addCandidate(f: FormData) {
  const s = await getSession();
  if (!HR.includes(s.role)) await fail("Yetkiniz yok.");
  const phone = normalizePhone(str(f, "phone"));
  if (!str(f, "first_name") || !str(f, "last_name") || !phone) await fail("Ad, soyad ve geçerli bir cep telefonu zorunlu.");
  const supabase = await createClient();
  const { data, error } = await supabase.from("candidates").insert({
    company_id: s.companyId, posting_id: str(f, "posting_id") || null,
    first_name: str(f, "first_name"), last_name: str(f, "last_name"), phone, email: str(f, "email") || null,
    experience: str(f, "experience") || null, about: str(f, "about") || null,
    source: ["manual", "iskur", "other"].includes(str(f, "source")) ? str(f, "source") : "manual",
    kvkk_consent_at: f.get("kvkk") === "on" ? new Date().toISOString() : null, created_by: s.userId,
  }).select("id").single();
  if (error || !data) await fail(missing(error?.message ?? "Kaydedilemedi"));
  const cv = f.get("cv");
  if (cv instanceof File && cv.size > 0) {
    const path = `${s.companyId}/candidates/${data!.id}/ozgecmis.${(cv.name.split(".").pop() || "pdf").toLowerCase()}`;
    const up = await supabase.storage.from("documents").upload(path, cv, { contentType: cv.type || undefined, upsert: true });
    if (!up.error) await supabase.from("candidates").update({ cv_path: path }).eq("id", data!.id);
  }
  revalidatePath("/ise-alim");
  redirect(`/ise-alim/${data!.id}`);
}

export async function moveStage(f: FormData) {
  const s = await getSession();
  if (!STAFF.includes(s.role)) await fail("Yetkiniz yok.");
  const stage = str(f, "stage");
  if (!STAGE_LABEL[stage] || stage === "hired") await fail("Geçersiz aşama.");
  if (stage === "rejected" && !str(f, "reason")) await fail("Ret nedeni yazın (adaya gösterilmez).");
  const supabase = await createClient();
  const { error } = await supabase.from("candidates").update({ stage, reject_reason: stage === "rejected" ? str(f, "reason") : null }).eq("id", str(f, "id"));
  if (error) await fail(missing(error.message));
  revalidatePath("/ise-alim");
  await done(`Aday "${STAGE_LABEL[stage]}" aşamasına alındı.`);
}

export async function scheduleInterview(f: FormData) {
  const s = await getSession();
  if (!STAFF.includes(s.role)) await fail("Yetkiniz yok.");
  const at = str(f, "at");
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(at)) await fail("Mülakat tarih ve saatini seçin.");
  const supabase = await createClient();
  const id = str(f, "id");
  const { error } = await supabase.from("candidates").update({ interview_at: `${at}:00+03:00`, interview_place: str(f, "place") || null, candidate_reply: null, candidate_reply_at: null, stage: "interview" }).eq("id", id);
  if (error) await fail(missing(error.message));
  await supabase.from("candidate_events").insert({ company_id: s.companyId, candidate_id: id, kind: "interview", body: `Mülakat: ${at.replace("T", " ")}${str(f, "place") ? ` · ${str(f, "place")}` : ""}` });
  revalidatePath(`/ise-alim/${id}`);
  await done("Mülakat planlandı. Davet mesajını WhatsApp ile gönderebilirsiniz.");
}

export async function addNote(f: FormData) {
  await getSession();
  const body = str(f, "body");
  if (!body) return;
  const supabase = await createClient();
  const { data: c } = await supabase.from("candidates").select("company_id").eq("id", str(f, "id")).maybeSingle();
  if (!c) await fail("Aday bulunamadı.");
  const { error } = await supabase.from("candidate_events").insert({ company_id: c!.company_id, candidate_id: str(f, "id"), kind: "note", body: body.slice(0, 2000) });
  if (error) await fail(error.message);
  revalidatePath(`/ise-alim/${str(f, "id")}`);
  await done("Not eklendi.");
}

export async function saveScores(f: FormData) {
  const s = await getSession();
  const supabase = await createClient();
  const id = str(f, "id");
  const rows = CRITERIA.map(([k]) => ({ company_id: s.companyId, candidate_id: id, criterion: k, score: Number(f.get(k)), note: str(f, `${k}_note`) || null, scored_by: s.userId }))
    .filter((r) => r.score >= 1 && r.score <= 5);
  if (!rows.length) await fail("En az bir ölçütü puanlayın.");
  const { error } = await supabase.from("candidate_scores").upsert(rows, { onConflict: "candidate_id,criterion,scored_by" });
  if (error) await fail(missing(error.message));
  revalidatePath(`/ise-alim/${id}`);
  await done("Puanlarınız kaydedildi.");
}

/** İşe al: personel kaydı açılır, aday bilgileri aktarılır, kayıt sihirbazına gidilir */
export async function hireCandidate(f: FormData) {
  const s = await getSession();
  if (!HR.includes(s.role)) await fail("Personel açma yetkiniz yok.");
  const id = str(f, "id");
  const hireDate = str(f, "hire_date");
  const branchId = str(f, "branch_id");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(hireDate) || !branchId) await fail("İşe başlama tarihi ve şube zorunlu.");
  const supabase = await createClient();
  const { data: c } = await supabase.from("candidates").select("*, job_postings(title, department_id)").eq("id", id).maybeSingle();
  if (!c) await fail("Aday bulunamadı.");
  if (c!.employee_id) redirect(`/personel/${c!.employee_id}/kayit?adim=1`);
  const post = c!.job_postings as { title: string; department_id: string | null } | null;
  const { data: e, error } = await supabase.from("employees").insert({
    company_id: s.companyId, branch_id: branchId, department_id: str(f, "department_id") || post?.department_id || null,
    first_name: c!.first_name, last_name: c!.last_name, position_title: post?.title ?? null, hire_date: hireDate,
    notes: `İşe alım: ${c!.tracking_code}`,
  }).select("id").single();
  if (error || !e) await fail(error?.message ?? "Personel açılamadı.");
  await supabase.from("employee_private").upsert({
    employee_id: e!.id, company_id: s.companyId, phone: c!.phone, email: c!.email, birth_date: c!.birth_date, district: c!.district,
    military_status: c!.military, updated_at: new Date().toISOString(),
  }, { onConflict: "employee_id" });
  await supabase.from("candidates").update({ stage: "hired", employee_id: e!.id, purge_after: new Date(Date.now() + 365 * 86_400_000).toISOString().slice(0, 10) }).eq("id", id);
  // Özgeçmişi personel özlük dosyasına kopyala
  if (c!.cv_path) {
    const ext = c!.cv_path.split(".").pop();
    const to = `${s.companyId}/employees/${e!.id}/ozgecmis-${Date.now()}.${ext}`;
    const cp = await supabase.storage.from("documents").copy(c!.cv_path, to);
    if (!cp.error) {
      const { data: t } = await supabase.from("document_types").select("id").or(`company_id.is.null,company_id.eq.${s.companyId}`).ilike("name", "%özgeçmiş%").limit(1).maybeSingle();
      if (t) await supabase.from("employee_documents").insert({ company_id: s.companyId, employee_id: e!.id, document_type_id: t.id, file_path: to, uploaded_by: s.userId });
    }
  }
  // Uyum süreci (onboarding) kontrol listesi
  await supabase.rpc("start_onboarding", { p_employee: e!.id, p_mentor: null });
  revalidatePath("/ise-alim");
  revalidatePath("/personel");
  redirect(`/personel/${e!.id}/kayit?adim=1`);
}

/** KVKK: aday verisini ve dosyalarını hemen sil */
export async function eraseCandidate(f: FormData) {
  const s = await getSession();
  if (!HR.includes(s.role)) await fail("Yetkiniz yok.");
  const supabase = await createClient();
  const id = str(f, "id");
  const { data: c } = await supabase.from("candidates").select("cv_path, file_paths, stage").eq("id", id).maybeSingle();
  if (!c) await fail("Aday bulunamadı.");
  const files = [c!.cv_path, ...(c!.file_paths ?? [])].filter(Boolean) as string[];
  if (files.length) await supabase.storage.from("documents").remove(files);
  const { error } = await supabase.from("candidates").delete().eq("id", id);
  if (error) await fail(error.message);
  revalidatePath("/ise-alim");
  redirect("/ise-alim?silindi=1");
}
