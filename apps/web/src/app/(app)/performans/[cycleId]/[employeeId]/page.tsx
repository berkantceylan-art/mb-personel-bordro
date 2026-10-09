import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PendingSubmit } from "@/components/ConfirmSubmit";
import { Card, PageHeader } from "@/components/ui";
import { LEVELS, SCORE_LABEL, attendanceFor, average, suggestedRaise, type Criterion } from "@/lib/performance";
import { formatDate, getSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { saveReview } from "../../actions";

const input = "rounded-[10px] border border-[#D5DEE8] bg-white px-3 text-sm";

export default async function ReviewPage({ params }: { params: Promise<{ cycleId: string; employeeId: string }> }) {
  const s = await getSession();
  if (!["owner", "accountant", "hr", "branch_manager"].includes(s.role)) redirect("/");
  const { cycleId, employeeId } = await params;
  const supabase = await createClient();
  const [{ data: c }, { data: r }, { data: e }, { data: sk }, { data: goals }, { data: prev }] = await Promise.all([
    supabase.from("review_cycles").select("*").eq("id", cycleId).maybeSingle(),
    supabase.from("reviews").select("*").eq("cycle_id", cycleId).eq("employee_id", employeeId).maybeSingle(),
    supabase.from("employees").select("id, first_name, last_name, hire_date, position_title, departments(name)").eq("id", employeeId).maybeSingle(),
    supabase.from("employee_skills").select("level, skills(name)").eq("employee_id", employeeId).order("level", { ascending: false }),
    supabase.from("goals").select("title, progress, status, due_on").eq("employee_id", employeeId).neq("status", "cancelled").order("due_on"),
    supabase.from("reviews").select("overall, review_cycles(name, period_end)").eq("employee_id", employeeId).neq("cycle_id", cycleId).not("overall", "is", null),
  ]);
  if (!c || !r || !e) notFound();
  const criteria = c.criteria as Criterion[];
  const self = (r.self_scores ?? {}) as Record<string, number>;
  const mgr = (r.mgr_scores ?? {}) as Record<string, number>;
  const att = await attendanceFor(supabase, employeeId, c.period_start, c.period_end);
  const selfAvg = average(self, criteria);
  const sugg = suggestedRaise(r.overall === null ? null : Number(r.overall));
  const open = c.status === "open";
  return (
    <>
      <PageHeader title={`${e.first_name} ${e.last_name}`} subtitle={`${c.name} · ${(e.departments as unknown as { name: string } | null)?.name ?? ""}${e.position_title ? ` · ${e.position_title}` : ""}`} actions={<Link href={`/performans/${cycleId}`} className="text-sm font-semibold text-brand-700">← Liste</Link>} />
      <div className="p-4 md:p-6 grid gap-4 lg:grid-cols-[1.5fr_1fr] items-start max-w-[1200px]">
        <Card title="Şef değerlendirmesi">
          {r.shared_at && <p className="text-xs rounded-lg bg-[#E7F1FB] text-brand-700 p-2">Personelle {formatDate(r.shared_at.slice(0, 10))} tarihinde paylaşıldı{r.acknowledged_at ? `; personel ${formatDate(r.acknowledged_at.slice(0, 10))} tarihinde okudu` : ""}.{r.employee_note ? ` Personelin notu: “${r.employee_note}”` : ""}</p>}
          <form action={saveReview} className="flex flex-col gap-3">
            <input type="hidden" name="id" value={r.id} />
            {criteria.map((k) => (
              <fieldset key={k.key} className="flex flex-col gap-1.5 border-b border-[#EEF2F6] pb-3">
                <legend className="text-sm font-semibold mb-1">{k.label}{self[k.key] ? <span className="ml-2 text-xs font-normal text-muted">öz değerlendirme: {self[k.key]}</span> : null}</legend>
                <div className="flex gap-1.5 flex-wrap">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <label key={n} className="cursor-pointer" title={SCORE_LABEL[n]}>
                      <input type="radio" name={k.key} value={n} defaultChecked={mgr[k.key] === n} disabled={!open} className="peer sr-only" />
                      <span className={`w-11 h-11 rounded-lg border grid place-items-center text-sm font-semibold peer-checked:bg-brand-700 peer-checked:text-white peer-checked:border-brand-700 peer-focus-visible:outline-2 peer-focus-visible:outline-brand-600 ${self[k.key] === n ? "border-[#7FA7D4] border-2" : "border-[#D5DEE8]"}`}>{n}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            ))}
            <p className="text-xs text-muted">1 {SCORE_LABEL[1]} · 3 {SCORE_LABEL[3]} · 5 {SCORE_LABEL[5]}. Mavi çerçeve personelin kendi verdiği puandır.</p>
            <label className="flex flex-col gap-1 text-sm text-muted">Güçlü yönleri<textarea name="strengths" rows={2} defaultValue={r.strengths ?? ""} className={`${input} py-2`} /></label>
            <label className="flex flex-col gap-1 text-sm text-muted">Gelişmesi gereken yönler<textarea name="improvements" rows={2} defaultValue={r.improvements ?? ""} className={`${input} py-2`} /></label>
            <label className="flex flex-col gap-1 text-sm text-muted">Genel yorum (personel görür)<textarea name="mgr_comment" rows={3} defaultValue={r.mgr_comment ?? ""} className={`${input} py-2`} /></label>
            <label className="flex flex-col gap-1 text-sm text-muted max-w-[260px]">Zam önerisi (%) <span className="text-xs">{sugg !== null ? `Puana göre öneri: %${sugg}` : "Kaydedince puana göre öneri görünür"} · personel görmez</span><input name="raise_pct" inputMode="decimal" defaultValue={r.raise_pct ?? ""} className={`${input} h-11`} /></label>
            {open && (
              <div className="flex flex-wrap gap-2">
                <PendingSubmit className="h-11 px-4 rounded-[10px] border border-[#D5DEE8] bg-white font-semibold text-brand-700">Kaydet</PendingSubmit>
                <PendingSubmit name="share" value="1" className="h-11 px-4 rounded-[10px] bg-brand-700 text-white font-semibold">Kaydet ve personelle paylaş</PendingSubmit>
              </div>
            )}
          </form>
        </Card>
        <div className="flex flex-col gap-4">
          <Card title="Puanlar">
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-xl bg-[#F2F6FB] p-3"><div className="text-xs text-muted">Şef puanı</div><div className="num text-2xl font-bold text-brand-800">{r.overall !== null ? Number(r.overall).toLocaleString("tr-TR") : "—"}</div></div>
              <div className="rounded-xl bg-[#F2F6FB] p-3"><div className="text-xs text-muted">Öz değerlendirme</div><div className="num text-2xl font-bold text-brand-800">{selfAvg !== null ? selfAvg.toLocaleString("tr-TR") : "—"}</div></div>
            </div>
            {r.self_comment && <p className="text-sm bg-[#F5F7FA] rounded-lg p-3"><b>Personelin yorumu:</b> {r.self_comment}</p>}
            {(prev ?? []).length > 0 && <ul className="text-xs text-muted">{(prev ?? []).map((p, i) => <li key={i}>{(p.review_cycles as unknown as { name: string } | null)?.name}: {Number(p.overall).toLocaleString("tr-TR")}</li>)}</ul>}
          </Card>
          <Card title="Devam ve dakiklik (puantajdan)">
            <ul className="text-sm grid grid-cols-2 gap-2">
              {([["Çalışılan gün", att.worked], ["Devamsızlık", `${att.absent} gün`], ["Geç kalma", `${att.late} kez · ${Math.round(att.lateMin / 6) / 10} sa`], ["Rapor", `${att.sickDays} gün`], ["Fazla mesai", `${att.overtimeHours} sa`]] as const).map(([l, v]) => (
                <li key={l} className="rounded-lg border border-line p-2"><div className="text-xs text-muted">{l}</div><div className="font-semibold num">{v}</div></li>
              ))}
            </ul>
            <p className="text-xs text-muted">Rapor günleri olumsuz değerlendirmede kullanılmamalıdır (hastalık nedeniyle ayrımcılık yasağı).</p>
          </Card>
          <Card title="Beceriler ve hedefler" action={<Link href={`/yetkinlik/${employeeId}`} className="text-sm font-semibold text-brand-700">Düzenle →</Link>}>
            <div className="flex flex-wrap gap-1.5">{(sk ?? []).filter((x) => x.level > 0).map((x, i) => <span key={i} className="text-xs rounded-full bg-[#EEF3F9] px-2.5 py-1">{(x.skills as unknown as { name: string } | null)?.name} · {LEVELS[x.level]}</span>)}{(sk ?? []).length === 0 && <span className="text-sm text-muted">Beceri girilmemiş.</span>}</div>
            <ul className="text-sm">{(goals ?? []).map((g, i) => <li key={i} className="py-1 flex justify-between gap-2"><span>{g.title}</span><span className="num text-muted">%{g.progress}</span></li>)}</ul>
          </Card>
        </div>
      </div>
    </>
  );
}
