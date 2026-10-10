"use server";
import { revalidatePath } from "next/cache";
import { done, fail } from "@/lib/flash";
import { uploadIsg } from "@/lib/isg-data";
import { getSession, todayIso } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const num = (f: FormData, k: string) => { const n = Number(str(f, k).replace(",", ".")); return Number.isFinite(n) && str(f, k) !== "" ? n : null; };
const isDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);
const missing = (m: string) => (/isg_|training_sessions|elearning|risk_|emergency_|committee_|equipment_|env_|sds_|min_hours_by_class|training_kind|body_part|root_cause/.test(m) ? "Supabase'de 20261119000000_isg.sql çalıştırılmalı." : m);

async function ctx() {
  const s = await getSession();
  if (!["owner", "hr", "safety"].includes(s.role)) await fail("Bu işlem için İSG yetkisi gerekiyor.");
  return { s, supabase: await createClient() };
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function run<T = unknown>(p: PromiseLike<any>): Promise<T> {
  const { error, data } = (await p) as { error: { message: string } | null; data: unknown };
  if (error) await fail(missing(error.message));
  return data as T;
}
async function upload(sb: Awaited<ReturnType<typeof createClient>>, cid: string, f: FormData, key: string, folder: string) {
  try { return await uploadIsg(sb, cid, f.get(key), folder); } catch (e) { await fail((e as Error).message); return null; }
}
const back = (...paths: string[]) => { for (const p of paths) revalidatePath(p); };

/* ============================================================ Şirket */
export async function saveCompanyIsg(f: FormData) {
  const { s, supabase } = await ctx();
  if (s.role !== "owner") await fail("Yalnız sahip değiştirebilir.");
  const hz = str(f, "hazard_class");
  if (!["AZ", "TEHLIKELI", "COK"].includes(hz)) await fail("Tehlike sınıfı seçin.");
  await run(supabase.from("companies").update({ hazard_class: hz, nace_code: str(f, "nace_code") || null }).eq("id", s.companyId));
  back("/isg", "/isg/katip", "/isg/egitim");
  await done("Tehlike sınıfı ve NACE kodu kaydedildi; süreler yeniden hesaplandı.");
}

/* ============================================================ 1) İSG-KATİP */
export async function saveProfessional(f: FormData) {
  const { s, supabase } = await ctx();
  const kind = str(f, "kind");
  if (!["uzman", "hekim", "dsp"].includes(kind) || !str(f, "full_name")) await fail("Tür ve ad soyad zorunlu.");
  const row = { company_id: s.companyId, kind, full_name: str(f, "full_name"), certificate_class: kind === "uzman" ? str(f, "certificate_class") || null : null, certificate_no: str(f, "certificate_no") || null, phone: str(f, "phone") || null, email: str(f, "email") || null, osgb_name: str(f, "osgb_name") || null, osgb_no: str(f, "osgb_no") || null, user_id: str(f, "user_id") || null };
  const id = str(f, "id");
  await run(id ? supabase.from("isg_professionals").update(row).eq("id", id) : supabase.from("isg_professionals").insert(row));
  back("/isg/katip");
  await done(id ? "Bilgiler güncellendi." : "İSG profesyoneli eklendi. Şimdi İSG-KATİP sözleşmesini girin.");
}
export async function toggleProfessional(f: FormData) {
  const { supabase } = await ctx();
  await run(supabase.from("isg_professionals").update({ active: str(f, "active") === "1" }).eq("id", str(f, "id")));
  back("/isg/katip");
  await done("Kaydedildi.");
}
export async function saveAssignment(f: FormData) {
  const { s, supabase } = await ctx();
  const a = str(f, "start_date"), b = str(f, "end_date");
  const min = num(f, "monthly_minutes");
  if (!str(f, "professional_id") || !isDate(a) || !min || min <= 0) await fail("Kişi, başlangıç tarihi ve aylık süre (dakika) zorunlu.");
  if (b && b < a) await fail("Bitiş başlangıçtan önce olamaz.");
  const doc = await upload(supabase, s.companyId, f, "file", "katip");
  const st = str(f, "katip_status") || "onay-bekliyor";
  const row: Record<string, unknown> = { company_id: s.companyId, professional_id: str(f, "professional_id"), start_date: a, end_date: b || null, monthly_minutes: Math.round(min!), katip_status: st, katip_no: str(f, "katip_no") || null, sent_on: str(f, "sent_on") || (st === "onay-bekliyor" ? todayIso() : null), approved_on: st === "onayli" ? str(f, "approved_on") || todayIso() : null, note: str(f, "note") || null };
  if (doc) row.document_path = doc;
  const id = str(f, "id");
  await run(id ? supabase.from("isg_assignments").update(row).eq("id", id) : supabase.from("isg_assignments").insert(row));
  back("/isg/katip");
  await done(st === "onay-bekliyor" ? "Sözleşme kaydedildi. İSG-KATİP'te onayınızı verin; onaylanınca durumu 'Onaylı' yapın." : "Sözleşme kaydedildi.");
}
export async function setAssignmentStatus(f: FormData) {
  const { supabase } = await ctx();
  const st = str(f, "status");
  if (!["onay-bekliyor", "onayli", "iptal", "sona-erdi"].includes(st)) await fail("Geçersiz durum.");
  await run(supabase.from("isg_assignments").update({ katip_status: st, ...(st === "onayli" ? { approved_on: todayIso() } : {}) }).eq("id", str(f, "id")));
  back("/isg/katip");
  await done("Durum güncellendi.");
}
export async function addVisit(f: FormData) {
  const { s, supabase } = await ctx();
  const d = str(f, "visit_date");
  const min = num(f, "hours") !== null ? Math.round(num(f, "hours")! * 60) : num(f, "minutes");
  if (!str(f, "professional_id") || !isDate(d) || !min || min <= 0) await fail("Kişi, tarih ve süre zorunlu.");
  await run(supabase.from("isg_visits").insert({ company_id: s.companyId, professional_id: str(f, "professional_id"), visit_date: d, minutes: Math.round(min!), topics: str(f, "topics") || null }));
  back("/isg/katip");
  await done("Ziyaret kaydedildi.");
}
export async function deleteRow(f: FormData) {
  const { supabase } = await ctx();
  const table = str(f, "table");
  const allowed = ["isg_visits", "isg_assignments", "emergency_drills", "emergency_team", "committee_members", "risk_items", "equipment_checks", "env_measurements", "sds_documents", "emergency_plans", "elearning_courses", "training_sessions"];
  if (!allowed.includes(table)) await fail("Geçersiz işlem.");
  await run(supabase.from(table).delete().eq("id", str(f, "id")));
  back("/isg", "/isg/katip", "/isg/egitim", "/isg/acil", "/isg/kurul", "/isg/risk", "/isg/kontrol");
  await done("Silindi.");
}

/* ============================================================ 2) Eğitim oturumu, sınav, uzaktan eğitim */
const addMonthsIso = (d: string, n: number) => { const t = new Date(d + "T12:00:00Z"); t.setUTCMonth(t.getUTCMonth() + n); return t.toISOString().slice(0, 10); };

export async function createSession(f: FormData) {
  const { s, supabase } = await ctx();
  const typeId = str(f, "type_id"), kind = str(f, "training_kind"), d = str(f, "held_on");
  const hours = num(f, "lesson_hours") ?? 0;
  const method = str(f, "method") || "yuz-yuze";
  const topics = f.getAll("topics").map(String);
  const ids = f.getAll("employee_ids").map(String).filter((x) => /^[0-9a-f-]{36}$/i.test(x));
  if (!typeId || !kind || !isDate(d) || hours <= 0 || !str(f, "trainer_name")) await fail("Eğitim türü, tarih, ders saati ve eğitici zorunlu.");
  if (!ids.length) await fail("Katılımcı seçin.");
  const [{ data: c }, { data: t }] = await Promise.all([
    supabase.from("companies").select("hazard_class").eq("id", s.companyId).single(),
    supabase.from("compliance_types").select("code, validity_months, validity_by_class").eq("id", typeId).single(),
  ]);
  const hz = (c?.hazard_class ?? "COK") as "AZ" | "TEHLIKELI" | "COK";
  if (kind === "ise-baslama" && (method !== "yuz-yuze" || hours < 2)) await fail("İşe başlama eğitimi yüz yüze ve en az 2 saat olmalı (Yönetmelik 2026).");
  if (method !== "yuz-yuze" && hz !== "AZ" && topics.some((x) => x.startsWith("4."))) await fail("4. konu başlığı (işyerine özgü riskler) tehlikeli ve çok tehlikeli işyerlerinde yüz yüze verilmelidir.");
  if (kind === "tekrar" && hours < 8) await fail("Tekrar eğitimi en az 8 ders saati olmalı.");
  const months = (t?.validity_by_class as Record<string, number> | null)?.[hz] ?? (t?.validity_months as number | null) ?? null;
  const expires = months && kind !== "ise-baslama" && kind !== "ilave" && kind !== "bilgi-yenileme" ? addMonthsIso(d, months) : null;
  const session = await run<{ id: string }>(supabase.from("training_sessions").insert({ company_id: s.companyId, type_id: typeId, training_kind: kind, held_on: d, start_time: str(f, "start_time") || null, end_time: str(f, "end_time") || null, lesson_hours: hours, method, trainer_name: str(f, "trainer_name"), trainer_title: str(f, "trainer_title") || null, location: str(f, "location") || null, topics, exam: f.get("exam") === "on", employee_ids: ids, note: str(f, "note") || null }).select("id").single());
  await run(supabase.from("training_records").insert(ids.map((employee_id) => ({ company_id: s.companyId, employee_id, type_id: typeId, done_on: d, hours, trainer: str(f, "trainer_name"), provider: str(f, "trainer_title") || null, expires_on: expires, session_id: session.id, training_kind: kind, method, topics, attempt: f.get("exam") === "on" ? 1 : null }))));
  back("/isg", "/isg/egitim", "/benim/isg");
  await done(`${ids.length} kişinin eğitimi kaydedildi.${f.get("exam") === "on" ? " Sınav notlarını oturum listesinden girin." : ""} Katılım tutanağını yazdırıp imzalatın.`);
}

/** Oturum sınav notları: 60 altı başarısız; başarısız olan ek sınava (deneme +1) girer */
export async function saveScores(f: FormData) {
  const { supabase } = await ctx();
  const sid = str(f, "session_id");
  const { data: recs } = await supabase.from("training_records").select("id, employee_id, attempt").eq("session_id", sid);
  let fails = 0;
  for (const r of recs ?? []) {
    const v = num(f, `score_${r.employee_id}`);
    if (v === null) continue;
    if (v < 0 || v > 100) await fail("Not 0–100 arasında olmalı.");
    const retry = f.get(`retry_${r.employee_id}`) === "on";
    if (v < 60) fails++;
    await run(supabase.from("training_records").update({ exam_score: Math.round(v), attempt: retry ? (r.attempt ?? 1) + 1 : r.attempt ?? 1 }).eq("id", r.id));
  }
  back("/isg/egitim");
  await done(fails ? `Notlar kaydedildi. ${fails} kişi başarısız (60 altı): en fazla 2 ek sınav hakkı var; yine başarısız olursa temel eğitimi yeniden alır.` : "Notlar kaydedildi.");
}

export async function saveCourse(f: FormData) {
  const { s, supabase } = await ctx();
  const group = Number(str(f, "topic_group"));
  if (!str(f, "title") || ![1, 2, 3, 4].includes(group) || !num(f, "duration_min")) await fail("Başlık, konu başlığı ve süre zorunlu.");
  const { data: c } = await supabase.from("companies").select("hazard_class").eq("id", s.companyId).single();
  if (group === 4 && c?.hazard_class !== "AZ") await fail("4. konu başlığı tehlikeli ve çok tehlikeli işyerlerinde uzaktan verilemez.");
  const video = await upload(supabase, s.companyId, f, "file", "egitim");
  if (!video && !str(f, "video_url")) await fail("Video bağlantısı veya dosyası gerekli.");
  // Soru biçimi: her satır "Soru | A ; B ; C ; D | doğru şık numarası (1-4)"
  let questions: Array<{ q: string; options: string[]; answer: number }> = [];
  try { questions = str(f, "questions").split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l, i) => {
    const [q = "", opts = "", ans = ""] = l.split("|").map((x) => x.trim());
    const options = opts.split(";").map((x) => x.trim()).filter(Boolean);
    const a = Number(ans) - 1;
    if (!q || options.length < 2 || !(a >= 0 && a < options.length)) throw new Error(`${i + 1}. soru satırı hatalı: "Soru | A ; B ; C | doğru şık no" biçiminde yazın.`);
    return { q, options, answer: a };
  }); } catch (e) { await fail((e as Error).message); }
  await run(supabase.from("elearning_courses").insert({ company_id: s.companyId, title: str(f, "title"), topic_group: group, description: str(f, "description") || null, video_url: str(f, "video_url") || null, video_path: video, duration_min: Math.round(num(f, "duration_min")!), lesson_hours: num(f, "lesson_hours") ?? 1, questions, type_id: str(f, "type_id") || null }));
  back("/isg/egitim", "/benim/isg");
  await done(`Uzaktan eğitim yayınlandı (${questions.length} soru). Personel telefonundan izleyip sınava girebilir.`);
}
export async function toggleCourse(f: FormData) {
  const { supabase } = await ctx();
  await run(supabase.from("elearning_courses").update({ active: str(f, "active") === "1" }).eq("id", str(f, "id")));
  back("/isg/egitim", "/benim/isg");
  await done("Kaydedildi.");
}

/* ============================================================ 3) Risk değerlendirmesi ve acil durum */
const addYearsIso = (d: string, n: number) => { const t = new Date(d + "T12:00:00Z"); t.setUTCFullYear(t.getUTCFullYear() + n); return t.toISOString().slice(0, 10); };
const RENEW: Record<string, number> = { COK: 2, TEHLIKELI: 4, AZ: 6 };

export async function createAssessment(f: FormData) {
  const { s, supabase } = await ctx();
  const d = str(f, "done_on");
  if (!str(f, "title") || !isDate(d)) await fail("Başlık ve tarih zorunlu.");
  const { data: c } = await supabase.from("companies").select("hazard_class").eq("id", s.companyId).single();
  const team = str(f, "team").split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => { const [name = "", role = ""] = l.split("|").map((x) => x.trim()); return { name, role }; });
  const a = await run<{ id: string }>(supabase.from("risk_assessments").insert({ company_id: s.companyId, title: str(f, "title"), method: str(f, "method") === "fine-kinney" ? "fine-kinney" : "5x5", done_on: d, valid_until: addYearsIso(d, RENEW[c?.hazard_class ?? "COK"] ?? 2), team, note: str(f, "note") || null }).select("id").single());
  if (f.get("template") === "on") {
    const { DENTAL_TEMPLATE } = await import("@/lib/isg");
    const fk = str(f, "method") === "fine-kinney";
    // 5x5 değerlerinden Fine-Kinney'e kaba dönüşüm: olasılık 0.5–10, frekans 3, şiddet 3–100
    const P = [0, 0.5, 1, 3, 6, 10], S = [0, 3, 7, 15, 40, 100];
    await run(supabase.from("risk_items").insert(DENTAL_TEMPLATE.map((t, i) => ({ company_id: s.companyId, assessment_id: a.id, area: t.area, activity: t.activity, hazard: t.hazard, risk: t.risk, affected: t.affected, p: fk ? P[t.p] : t.p, s: fk ? S[t.s] : t.s, f: fk ? 3 : null, existing_controls: t.controls, actions: t.actions, sort: i }))));
  }
  back("/isg/risk");
  await done("Risk değerlendirmesi oluşturuldu. Satırları ekip ile gözden geçirin, sorumlu ve termin girin.");
}
export async function saveRiskItem(f: FormData) {
  const { s, supabase } = await ctx();
  const p = num(f, "p"), sv = num(f, "s");
  if (!str(f, "assessment_id") || !str(f, "hazard") || !str(f, "risk") || !p || !sv) await fail("Tehlike, risk, olasılık ve şiddet zorunlu.");
  const row = { company_id: s.companyId, assessment_id: str(f, "assessment_id"), area: str(f, "area") || "Genel", activity: str(f, "activity") || null, hazard: str(f, "hazard"), risk: str(f, "risk"), affected: str(f, "affected") || null, p, s: sv, f: num(f, "f"), existing_controls: str(f, "existing_controls") || null, actions: str(f, "actions") || null, responsible: str(f, "responsible") || null, due_date: str(f, "due_date") || null, done_on: str(f, "done_on") || null, rp: num(f, "rp"), rs: num(f, "rs"), rf: num(f, "rf") };
  const id = str(f, "id");
  await run(id ? supabase.from("risk_items").update(row).eq("id", id) : supabase.from("risk_items").insert(row));
  back(`/isg/risk/${row.assessment_id}`, "/isg/risk");
  await done("Kaydedildi.");
}
export async function setAssessmentStatus(f: FormData) {
  const { s, supabase } = await ctx();
  const st = str(f, "status"), id = str(f, "id");
  if (!["taslak", "yururlukte", "arsiv"].includes(st)) await fail("Geçersiz durum.");
  if (st === "yururlukte") await run(supabase.from("risk_assessments").update({ status: "arsiv" }).eq("company_id", s.companyId).eq("status", "yururlukte").neq("id", id));
  await run(supabase.from("risk_assessments").update({ status: st }).eq("id", id));
  back("/isg/risk", `/isg/risk/${id}`);
  await done(st === "yururlukte" ? "Yürürlüğe alındı; önceki değerlendirme arşivlendi. Sonuçları çalışanlara duyurun." : "Durum güncellendi.");
}
export async function announceAssessment(f: FormData) {
  const { s, supabase } = await ctx();
  const id = str(f, "id");
  const { data: a } = await supabase.from("risk_assessments").select("title, done_on").eq("id", id).single();
  const { data: items } = await supabase.from("risk_items").select("area, hazard, actions, p, s, f").eq("assessment_id", id).order("sort");
  const top = (items ?? []).map((x) => ({ ...x, score: Number(x.p) * Number(x.s) * Number(x.f ?? 1) })).sort((x, y) => y.score - x.score).slice(0, 6);
  await run(supabase.from("announcements").insert({ company_id: s.companyId, title: `Risk değerlendirmesi: ${a?.title ?? ""}`, audience: "ALL", department_ids: [], branch_ids: [], pinned: true, push: true, kind: "info", require_ack: true,
    body: `İşyerimizin risk değerlendirmesi yapıldı (6331 s. Kanun md. 16: çalışanların bilgilendirilmesi). Öne çıkan riskler ve önlemler:\n${top.map((x) => `• ${x.area}: ${x.hazard} → ${x.actions ?? ""}`).join("\n")}\nTam rapor İSG biriminde ve panoda. Okuduğunuzu onaylayın.` }));
  await run(supabase.from("risk_assessments").update({ announced_at: new Date().toISOString() }).eq("id", id));
  back(`/isg/risk/${id}`, "/duyurular");
  await done("Sonuçlar okundu onaylı duyuru olarak tüm çalışanlara gönderildi.");
}
export async function saveEmergencyPlan(f: FormData) {
  const { s, supabase } = await ctx();
  const d = str(f, "done_on");
  if (!isDate(d)) await fail("Tarih zorunlu.");
  const { data: c } = await supabase.from("companies").select("hazard_class").eq("id", s.companyId).single();
  const doc = await upload(supabase, s.companyId, f, "file", "acil");
  await run(supabase.from("emergency_plans").insert({ company_id: s.companyId, title: str(f, "title") || "Acil durum planı", done_on: d, valid_until: addYearsIso(d, RENEW[c?.hazard_class ?? "COK"] ?? 2), document_path: doc, note: str(f, "note") || null }));
  back("/isg/acil");
  await done("Acil durum planı kaydedildi.");
}
export async function addDrill(f: FormData) {
  const { s, supabase } = await ctx();
  const d = str(f, "held_on");
  if (!isDate(d) || !str(f, "scenario")) await fail("Tarih ve senaryo zorunlu.");
  const doc = await upload(supabase, s.companyId, f, "file", "tatbikat");
  await run(supabase.from("emergency_drills").insert({ company_id: s.companyId, held_on: d, scenario: str(f, "scenario"), participants: num(f, "participants"), duration_min: num(f, "duration_min"), findings: str(f, "findings") || null, document_path: doc }));
  back("/isg/acil");
  await done("Tatbikat kaydedildi.");
}
export async function addTeamMember(f: FormData) {
  const { s, supabase } = await ctx();
  const team = str(f, "team");
  if (!str(f, "employee_id") || !["sondurme", "kurtarma", "koruma", "ilkyardim"].includes(team)) await fail("Personel ve ekip seçin.");
  await run(supabase.from("emergency_team").upsert({ company_id: s.companyId, employee_id: str(f, "employee_id"), team, trained_on: str(f, "trained_on") || null, certificate_until: str(f, "certificate_until") || null }, { onConflict: "employee_id,team" }));
  back("/isg/acil");
  await done("Ekibe eklendi.");
}

/* ============================================================ 4) Kurul ve tespit-öneri defteri */
export async function addCommitteeMember(f: FormData) {
  const { s, supabase } = await ctx();
  if (!str(f, "role") || (!str(f, "employee_id") && !str(f, "full_name"))) await fail("Görev ve kişi zorunlu.");
  await run(supabase.from("committee_members").insert({ company_id: s.companyId, role: str(f, "role"), employee_id: str(f, "employee_id") || null, full_name: str(f, "full_name") || null, since: str(f, "since") || todayIso() }));
  back("/isg/kurul");
  await done("Kurul üyesi eklendi.");
}
export async function saveMeeting(f: FormData) {
  const { s, supabase } = await ctx();
  const d = str(f, "held_on");
  if (!isDate(d)) await fail("Tarih zorunlu.");
  const { count } = await supabase.from("committee_meetings").select("id", { count: "exact", head: true });
  const lines = (k: string) => str(f, k).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const decisions = lines("decisions").map((l) => { const [text = "", responsible = "", due = ""] = l.split("|").map((x) => x.trim()); return { text, responsible, due: isDate(due) ? due : null, status: "acik" }; });
  const doc = await upload(supabase, s.companyId, f, "file", "kurul");
  await run(supabase.from("committee_meetings").insert({ company_id: s.companyId, meeting_no: (count ?? 0) + 1, held_on: d, agenda: lines("agenda"), attendees: f.getAll("attendees").map(String), notes: str(f, "notes") || null, decisions, document_path: doc }));
  back("/isg/kurul");
  await done("Toplantı kaydedildi. Tutanağı yazdırıp imzalatın; kararlar takip listesine eklendi.");
}
export async function closeDecision(f: FormData) {
  const { supabase } = await ctx();
  const id = str(f, "id"), i = Number(str(f, "i"));
  const { data: m } = await supabase.from("committee_meetings").select("decisions").eq("id", id).single();
  const list = ((m?.decisions as Array<Record<string, unknown>>) ?? []).map((d, k) => (k === i ? { ...d, status: "kapandi", closed_on: todayIso() } : d));
  await run(supabase.from("committee_meetings").update({ decisions: list }).eq("id", id));
  back("/isg/kurul");
  await done("Karar kapatıldı.");
}
export async function saveFinding(f: FormData) {
  const { s, supabase } = await ctx();
  if (!str(f, "description")) await fail("Tespiti yazın.");
  const photo = await upload(supabase, s.companyId, f, "photo", "tespit");
  await run(supabase.from("isg_findings").insert({ company_id: s.companyId, found_on: str(f, "found_on") || todayIso(), author_kind: str(f, "author_kind") || null, author_name: str(f, "author_name") || null, area: str(f, "area") || null, description: str(f, "description"), recommendation: str(f, "recommendation") || null, level: str(f, "level") || "orta", responsible: str(f, "responsible") || null, due_date: str(f, "due_date") || null, photo_path: photo, book_page: str(f, "book_page") || null }));
  back("/isg/defter");
  await done("Tespit kaydedildi; sahip ve İK'ya bildirim gitti.");
}
export async function ackFinding(f: FormData) {
  const { s, supabase } = await ctx();
  if (!["owner", "hr"].includes(s.role)) await fail("Tebellüğü işveren veya vekili verir.");
  await run(supabase.from("isg_findings").update({ employer_ack_at: new Date().toISOString(), employer_ack_by: s.userId, status: "islemde", responsible: str(f, "responsible") || undefined, due_date: str(f, "due_date") || undefined }).eq("id", str(f, "id")));
  back("/isg/defter");
  await done("Tespit tebellüğ edildi, işleme alındı.");
}
export async function closeFinding(f: FormData) {
  const { s, supabase } = await ctx();
  const photo = await upload(supabase, s.companyId, f, "photo", "tespit");
  await run(supabase.from("isg_findings").update({ status: "kapandi", closed_on: todayIso(), close_note: str(f, "close_note") || null, ...(photo ? { close_photo_path: photo } : {}) }).eq("id", str(f, "id")));
  back("/isg/defter");
  await done("Tespit kapatıldı.");
}

/* ============================================================ 5) Kaza, kontroller, ölçümler, GBF */
export async function saveIncident(f: FormData) {
  const { s, supabase } = await ctx();
  const kind = str(f, "kind");
  const at = str(f, "occurred_at");
  if (!["KAZA", "RAMAK_KALA", "MESLEK_HASTALIGI"].includes(kind) || !at || !str(f, "description")) await fail("Tür, tarih-saat ve açıklama zorunlu.");
  const row = { company_id: s.companyId, employee_id: str(f, "employee_id") || null, kind, occurred_at: `${at}:00+03:00`, location: str(f, "location") || null, description: str(f, "description"), injury: str(f, "injury") || null, body_part: str(f, "body_part") || null, injury_type: str(f, "injury_type") || null, witnesses: str(f, "witnesses") || null, hospital: str(f, "hospital") || null, report_days: num(f, "report_days"), lost_days: num(f, "lost_days"), actions_taken: str(f, "actions_taken") || null };
  await run(supabase.from("safety_incidents").insert(row));
  back("/isg/kaza", "/isg/egitim");
  await done(kind === "RAMAK_KALA" ? "Ramak kala kaydedildi." : "Kaydedildi. SGK'ya 3 iş günü içinde bildirin; personel işe dönmeden önce ilave eğitim alacak.");
}
export async function updateIncident(f: FormData) {
  const { supabase } = await ctx();
  const patch: Record<string, unknown> = {};
  for (const k of ["root_cause", "corrective_actions", "sgk_ref"]) if (f.has(k)) patch[k] = str(f, k) || null;
  for (const k of ["sgk_notified_on", "returned_on"]) if (f.has(k)) patch[k] = str(f, k) || null;
  for (const k of ["lost_days", "report_days"]) if (f.has(k)) patch[k] = num(f, k);
  if (f.get("close") === "1") patch.status = "closed";
  await run(supabase.from("safety_incidents").update(patch).eq("id", str(f, "id")));
  back("/isg/kaza");
  await done("Kaydedildi.");
}
export async function saveEquipment(f: FormData) {
  const { s, supabase } = await ctx();
  const months = num(f, "period_months");
  if (!str(f, "equipment") || !str(f, "category") || !months) await fail("Ekipman, kategori ve periyot zorunlu.");
  const last = str(f, "last_check");
  const doc = await upload(supabase, s.companyId, f, "file", "kontrol");
  const row: Record<string, unknown> = { company_id: s.companyId, equipment: str(f, "equipment"), category: str(f, "category"), location: str(f, "location") || null, serial_no: str(f, "serial_no") || null, period_months: months, last_check: last || null, next_due: last ? addMonthsIso(last, months!) : str(f, "next_due") || null, inspector: str(f, "inspector") || null, result: str(f, "result") || null, note: str(f, "note") || null };
  if (doc) row.report_path = doc;
  const id = str(f, "id");
  await run(id ? supabase.from("equipment_checks").update(row).eq("id", id) : supabase.from("equipment_checks").insert(row));
  back("/isg/kontrol");
  await done("Periyodik kontrol kaydedildi.");
}
export async function saveMeasurement(f: FormData) {
  const { s, supabase } = await ctx();
  const d = str(f, "measured_on");
  if (!str(f, "kind") || !isDate(d)) await fail("Ölçüm türü ve tarihi zorunlu.");
  const value = num(f, "value"), limit = num(f, "limit_value");
  const doc = await upload(supabase, s.companyId, f, "file", "olcum");
  await run(supabase.from("env_measurements").insert({ company_id: s.companyId, kind: str(f, "kind"), measured_on: d, location: str(f, "location") || null, value, unit: str(f, "unit") || null, limit_value: limit, compliant: value !== null && limit !== null ? value <= limit : f.get("compliant") === "on" ? true : null, lab: str(f, "lab") || null, next_due: str(f, "next_due") || addYearsIso(d, 1), report_path: doc, note: str(f, "note") || null }));
  back("/isg/kontrol");
  await done("Ölçüm kaydedildi.");
}
export async function saveSds(f: FormData) {
  const { s, supabase } = await ctx();
  if (!str(f, "product")) await fail("Ürün adı zorunlu.");
  const doc = await upload(supabase, s.companyId, f, "file", "gbf");
  await run(supabase.from("sds_documents").insert({ company_id: s.companyId, product: str(f, "product"), supplier: str(f, "supplier") || null, hazards: str(f, "hazards") || null, used_in: str(f, "used_in") || null, revised_on: str(f, "revised_on") || null, document_path: doc }));
  back("/isg/kontrol");
  await done("Güvenlik bilgi formu eklendi.");
}
