import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PendingSubmit } from "@/components/ConfirmSubmit";
import { Card, PageHeader } from "@/components/ui";
import { OWNER_LABEL, PHASES, PROBATION_CRITERIA } from "@/lib/onboarding";
import { formatDate, getSession, todayIso } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { saveOnboarding, startOnboarding, toggleTask } from "../actions";

const input = "h-11 rounded-[10px] border border-[#D5DEE8] bg-white px-3 text-sm";

export default async function OnboardingDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!["owner", "accountant", "hr", "branch_manager"].includes(s.role)) redirect("/");
  const { id } = await params;
  const supabase = await createClient();
  const [{ data: e }, { data: o }, { data: tasks }, { data: staff }] = await Promise.all([
    supabase.from("employees").select("id, first_name, last_name, hire_date, departments(name)").eq("id", id).maybeSingle(),
    supabase.from("employee_onboarding").select("*").eq("employee_id", id).maybeSingle(),
    supabase.from("onboarding_tasks").select("id, phase, title, description, owner, due_on, done_at, note").eq("employee_id", id).order("sort"),
    supabase.from("employees").select("id, first_name, last_name").neq("status", "terminated").neq("id", id).order("first_name"),
  ]);
  if (!e) notFound();
  const today = todayIso();
  const scores = (o?.eval_scores ?? {}) as Record<string, number>;
  const left = o?.probation_end ? Math.round((Date.parse(o.probation_end) - Date.parse(today)) / 86_400_000) : null;
  return (
    <>
      <PageHeader title={`${e.first_name} ${e.last_name} · uyum`} subtitle={`${(e.departments as unknown as { name: string } | null)?.name ?? ""} · işe giriş ${e.hire_date ? formatDate(e.hire_date) : "—"}`} actions={<div className="flex gap-3"><Link href={`/personel/${id}`} className="text-sm font-semibold text-brand-700">Personel kartı</Link><Link href="/uyum" className="text-sm font-semibold text-brand-700">← Uyum</Link></div>} />
      <div className="p-4 md:p-6 grid gap-4 lg:grid-cols-[1.4fr_1fr] items-start max-w-[1200px]">
        {!o ? (
          <Card title="Uyum süreci başlatılmamış">
            <form action={startOnboarding} className="flex flex-wrap gap-2 items-center">
              <input type="hidden" name="employee_id" value={id} />
              <select name="mentor" className={input}><option value="">Mentor (isteğe bağlı)</option>{(staff ?? []).map((x) => <option key={x.id} value={x.id}>{x.first_name} {x.last_name}</option>)}</select>
              <PendingSubmit className="h-11 px-4 rounded-[10px] bg-brand-700 text-white font-semibold">Başlat</PendingSubmit>
            </form>
          </Card>
        ) : (
          <>
            <Card title="Kontrol listesi">
              {PHASES.map(([ph, label]) => {
                const list = (tasks ?? []).filter((t) => t.phase === ph);
                if (!list.length) return null;
                return (
                  <section key={ph} className="flex flex-col gap-1">
                    <h3 className="text-xs font-bold uppercase tracking-wide text-brand-600">{label} · {list.filter((t) => t.done_at).length}/{list.length}</h3>
                    <ul className="divide-y divide-[#EEF2F6]">
                      {list.map((t) => {
                        const late = !t.done_at && t.due_on < today;
                        return (
                          <li key={t.id} className="py-2 flex gap-3 items-start">
                            <form action={toggleTask}>
                              <input type="hidden" name="id" value={t.id} /><input type="hidden" name="done" value={t.done_at ? "0" : "1"} />
                              <button aria-label={t.done_at ? `${t.title}: tamamlanmadı yap` : `${t.title}: tamamlandı`} className={`w-7 h-7 rounded-md border-2 grid place-items-center ${t.done_at ? "bg-[#1A7F52] border-[#1A7F52] text-white" : "border-[#9FB3C8] bg-white"}`}>{t.done_at ? "✓" : ""}</button>
                            </form>
                            <div className="flex-1 min-w-0">
                              <div className={`text-sm ${t.done_at ? "line-through text-muted" : "font-medium"}`}>{t.title}</div>
                              <div className="text-xs text-muted">{OWNER_LABEL[t.owner]} · {t.done_at ? `tamamlandı ${formatDate(t.done_at.slice(0, 10))}` : <span className={late ? "text-bad font-semibold" : ""}>son gün {formatDate(t.due_on)}</span>}{t.description ? ` · ${t.description}` : ""}</div>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                );
              })}
            </Card>
            <Card title="Mentor ve deneme süresi değerlendirmesi">
              <form action={saveOnboarding} className="flex flex-col gap-3 text-sm">
                <input type="hidden" name="employee_id" value={id} />
                <label className="flex flex-col gap-1 text-muted">Usta / mentor<select name="mentor" defaultValue={o.mentor_employee_id ?? ""} className={input}><option value="">—</option>{(staff ?? []).map((x) => <option key={x.id} value={x.id}>{x.first_name} {x.last_name}</option>)}</select></label>
                <label className="flex flex-col gap-1 text-muted">Hoş geldin notu (personel görür)<textarea name="welcome_note" rows={2} defaultValue={o.welcome_note ?? ""} className={`${input} h-auto py-2`} /></label>
                <label className="flex flex-col gap-1 text-muted">Deneme süresi bitişi<input type="date" name="probation_end" defaultValue={o.probation_end ?? ""} className={input} /></label>
                <p className={`text-xs ${left !== null && left <= 14 && !o.probation_decision ? "text-bad font-semibold" : "text-muted"}`}>{o.probation_decision ? `Karar verildi: ${o.probation_decision === "continue" ? "devam" : "sonlandır"} (${formatDate(String(o.decided_at).slice(0, 10))})` : left === null ? "" : left < 0 ? `Deneme süresi ${-left} gün önce bitti; karar girilmedi.` : `Deneme süresinin bitmesine ${left} gün var. İş Kanunu md. 15: en çok 2 ay (toplu sözleşmeyle 4 ay); bu süre içinde bildirimsiz ve tazminatsız fesih yapılabilir.`}</p>
                <fieldset className="flex flex-col gap-2 border border-line rounded-xl p-3">
                  <legend className="px-1 font-semibold">Şef değerlendirmesi (1–5)</legend>
                  {PROBATION_CRITERIA.map(([k, l]) => (
                    <div key={k} className="flex items-center gap-2 flex-wrap"><span className="w-36">{l}</span>
                      {[1, 2, 3, 4, 5].map((n) => <label key={n} className="cursor-pointer"><input type="radio" name={k} value={n} defaultChecked={scores[k] === n} className="peer sr-only" /><span className="w-9 h-9 rounded-lg border border-[#D5DEE8] grid place-items-center font-semibold peer-checked:bg-brand-700 peer-checked:text-white peer-focus-visible:outline-2 peer-focus-visible:outline-brand-600">{n}</span></label>)}
                    </div>
                  ))}
                </fieldset>
                <label className="flex flex-col gap-1 text-muted">Karar<select name="decision" defaultValue={o.probation_decision ?? ""} className={input}><option value="">Henüz karar yok</option><option value="continue">Devam (kadroya geçsin)</option><option value="terminate">Sonlandır</option></select></label>
                <label className="flex flex-col gap-1 text-muted">Değerlendirme notu<textarea name="decision_note" rows={2} defaultValue={o.decision_note ?? ""} className={`${input} h-auto py-2`} /></label>
                <PendingSubmit className="h-11 px-4 rounded-[10px] bg-brand-700 text-white font-semibold self-start">Kaydet</PendingSubmit>
                {o.probation_decision === "terminate" && <Link href={`/personel/${id}/cikis`} className="text-sm font-semibold text-bad">İşten çıkış sihirbazını aç →</Link>}
              </form>
            </Card>
          </>
        )}
      </div>
    </>
  );
}
