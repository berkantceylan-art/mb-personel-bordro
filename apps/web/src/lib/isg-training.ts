/**
 * 2026 eğitim yönetmeliğine göre personel bazında eğitim yükümlülükleri (RG 02.04.2026/33212):
 * işe başlama (fiilen çalışmadan önce, yüz yüze, ≥2 saat), temel (8/12/16 ders saati, işe girişten itibaren en geç 3 ay),
 * tekrar (1/2/3 yılda bir, ≥8 saat), sınav (≥60 puan, en fazla 2 ek sınav), ilave (kaza / meslek hastalığı sonrası),
 * bilgi yenileme (6 aydan uzun ayrılık sonrası işe dönmeden önce).
 */
import type { HazardClass } from "@mb/core";
import type { createClient } from "@/lib/supabase/server";
import { TRAINING_RULES as R } from "@/lib/isg";
import { fetchAll } from "@/lib/timekeeping";

type SB = Awaited<ReturnType<typeof createClient>>;
export const REG_DATE = "2026-04-02";
const DAY = 86_400_000;
const addMonths = (d: string, n: number) => { const t = new Date(d + "T12:00:00Z"); t.setUTCMonth(t.getUTCMonth() + n); return t.toISOString().slice(0, 10); };
const daysTo = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / DAY);

export type ObState = "ok" | "soon" | "due" | "late" | "missing" | "na" | "info";
export type Ob = { state: ObState; text: string; due?: string | null };
export type EmpTraining = { id: string; name: string; dept: string; hire: string | null; onboarding: Ob; base: Ob; repeat: Ob; extra: Ob; refresh: Ob; exam: Ob; issues: number };
type Rec = { employee_id: string; code: string; done_on: string; hours: number; kind: string | null; score: number | null; attempt: number | null };

export async function loadTraining(sb: SB, hazard: HazardClass, today: string) {
  const [{ data: emps }, { data: types }, recs, { data: inc }, leaves] = await Promise.all([
    sb.from("employees").select("id, first_name, last_name, hire_date, departments(name)").eq("status", "active").order("first_name"),
    sb.from("compliance_types").select("id, code").eq("category", "TRAINING"),
    fetchAll<Record<string, unknown>>((a, b) => sb.from("training_records").select("employee_id, type_id, done_on, hours, training_kind, exam_score, attempt").order("done_on").range(a, b)),
    sb.from("safety_incidents").select("employee_id, kind, occurred_at").in("kind", ["KAZA", "MESLEK_HASTALIGI"]),
    fetchAll<Record<string, unknown>>((a, b) => sb.from("leave_requests").select("employee_id, start_date, end_date").eq("status", "approved").order("start_date").range(a, b)),
  ]);
  const code = new Map((types ?? []).map((t) => [t.id as string, t.code as string]));
  const R2: Rec[] = recs.map((r) => ({ employee_id: r.employee_id as string, code: code.get(r.type_id as string) ?? "", done_on: r.done_on as string, hours: Number(r.hours ?? 0), kind: (r.training_kind as string | null) ?? null, score: r.exam_score === null || r.exam_score === undefined ? null : Number(r.exam_score), attempt: (r.attempt as number | null) ?? null }));
  const out: EmpTraining[] = [];
  for (const e of (emps ?? []) as Array<Record<string, unknown>>) {
    const id = e.id as string;
    const hire = (e.hire_date as string | null) ?? null;
    const mine = R2.filter((r) => r.employee_id === id);
    const passed = (r: Rec) => r.score === null || r.score >= R.passScore;
    // 1) İşe başlama
    const ob1 = mine.find((r) => r.code === "ISE_BASLAMA" || r.kind === "ise-baslama");
    const onboarding: Ob = ob1 ? (ob1.hours && ob1.hours < R.onboardingHours ? { state: "due", text: `${ob1.hours} saat (en az 2)` } : { state: "ok", text: fmt(ob1.done_on) })
      : hire && hire >= REG_DATE ? { state: "missing", text: "Yapılmadı", due: hire } : { state: "info", text: "Kayıt yok" };
    // 2) Temel eğitim: işe girişten sonraki temel kayıtlarının toplam ders saati
    const baseRecs = mine.filter((r) => r.code === "TEMEL_ISG" && r.kind !== "tekrar" && passed(r));
    const baseHours = baseRecs.reduce((s, r) => s + r.hours, 0);
    const need = R.baseHours[hazard];
    const baseDue = hire ? addMonths(hire, R.baseDeadlineMonths) : null;
    const anyTemel = mine.filter((r) => r.code === "TEMEL_ISG" && passed(r));
    const base: Ob = baseHours >= need || (anyTemel.length > 0 && baseHours === 0 && anyTemel.some((r) => !r.hours))
      ? { state: "ok", text: baseHours ? `${baseHours} saat` : "Yapıldı" }
      : baseDue && today > baseDue ? { state: "late", text: `${baseHours}/${need} saat · süre ${fmt(baseDue)} doldu`, due: baseDue }
      : { state: baseHours ? "due" : "missing", text: `${baseHours}/${need} saat · son ${baseDue ? fmt(baseDue) : "—"}`, due: baseDue };
    // 3) Tekrar: son temel/tekrar tarihinden itibaren periyot
    const last = anyTemel.filter((r) => r.kind !== "tekrar" || r.hours === 0 || r.hours >= R.repeatHours).map((r) => r.done_on).sort().pop();
    const repDue = last ? addMonths(last, R.repeatMonths[hazard]) : null;
    const repeat: Ob = !last ? { state: "na", text: "Temel eğitimden sonra" } : today > repDue! ? { state: "late", text: `${fmt(repDue!)} geçti`, due: repDue } : daysTo(today, repDue!) <= 30 ? { state: "soon", text: `${fmt(repDue!)}`, due: repDue } : { state: "ok", text: fmt(repDue!), due: repDue };
    // 4) İlave: kaza / meslek hastalığı sonrası
    const lastInc = (inc ?? []).filter((x) => x.employee_id === id).map((x) => String(x.occurred_at).slice(0, 10)).sort().pop();
    const ilave = lastInc ? mine.find((r) => (r.code === "ILAVE" || r.kind === "ilave") && r.done_on >= lastInc) : null;
    const extra: Ob = !lastInc ? { state: "na", text: "—" } : ilave ? { state: "ok", text: fmt(ilave.done_on) } : { state: "missing", text: `Kaza ${fmt(lastInc)} sonrası yapılmadı`, due: lastInc };
    // 5) Bilgi yenileme: 6 aydan uzun kesintisiz izin / ayrılık
    const long = leaves.filter((l) => l.employee_id === id && daysTo(l.start_date as string, l.end_date as string) >= 182).map((l) => ({ s: l.start_date as string, e: l.end_date as string })).sort((a, b) => a.e.localeCompare(b.e)).pop();
    const yen = long ? mine.find((r) => (r.code === "BILGI_YENILEME" || r.kind === "bilgi-yenileme") && r.done_on >= long.s) : null;
    const refresh: Ob = !long ? { state: "na", text: "—" } : yen ? { state: "ok", text: fmt(yen.done_on) } : { state: long.e >= today ? "due" : "missing", text: `İşe dönüş ${fmt(long.e)} öncesi`, due: long.e };
    // 6) Sınav: başarısız son sonuç
    const scored = mine.filter((r) => r.score !== null).sort((a, b) => a.done_on.localeCompare(b.done_on));
    const lastS = scored.pop();
    const exam: Ob = !lastS ? { state: "na", text: "—" } : lastS.score! >= R.passScore ? { state: "ok", text: `${lastS.score} puan` } : (lastS.attempt ?? 1) >= R.maxAttempts ? { state: "late", text: `${lastS.score} puan · haklar bitti, temel eğitimi yeniden alacak` } : { state: "due", text: `${lastS.score} puan · ${R.maxAttempts - (lastS.attempt ?? 1)} ek sınav hakkı` };
    const list = [onboarding, base, repeat, extra, refresh, exam];
    out.push({ id, name: `${e.first_name} ${e.last_name}`, dept: (e.departments as { name: string } | null)?.name ?? "Bölümsüz", hire, onboarding, base, repeat, extra, refresh, exam, issues: list.filter((o) => ["late", "missing", "due"].includes(o.state)).length });
  }
  return out.sort((a, b) => b.issues - a.issues || a.dept.localeCompare(b.dept, "tr") || a.name.localeCompare(b.name, "tr"));
}

const fmt = (d: string) => d.split("-").reverse().join(".");
export const OB_STYLE: Record<ObState, string> = { ok: "bg-ok-bg text-ok", soon: "bg-warn-bg text-warn", due: "bg-warn-bg text-warn font-semibold", late: "bg-bad-bg text-bad font-semibold", missing: "bg-bad-bg text-bad font-semibold", na: "text-[#9AA6B2]", info: "bg-[#EEF2F6] text-[#5A6878]" };
