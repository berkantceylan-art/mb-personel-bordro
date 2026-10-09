import Link from "next/link";
import { redirect } from "next/navigation";
import { PendingSubmit } from "@/components/ConfirmSubmit";
import { Card, PageHeader } from "@/components/ui";
import { OWNER_LABEL, PHASES, PHASE_LABEL } from "@/lib/onboarding";
import { formatDate, getSession, todayIso } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { addItem, removeItem, startOnboarding } from "./actions";

const input = "h-10 rounded-[10px] border border-[#D5DEE8] bg-white px-2 text-sm";
const days = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

/** Uyum süreci: yeni başlayanların kontrol listeleri ve deneme süresi kararları */
export default async function OnboardingListPage() {
  const s = await getSession();
  if (!["owner", "accountant", "hr", "branch_manager"].includes(s.role)) redirect("/");
  const supabase = await createClient();
  const today = todayIso();
  const since = new Date(Date.now() - 150 * 86_400_000).toISOString().slice(0, 10);
  const [{ data: ob, error }, { data: tasks }, { data: recent }, { data: items }, { data: staff }] = await Promise.all([
    supabase.from("employee_onboarding").select("employee_id, started_on, probation_end, probation_decision, mentor:employees!employee_onboarding_mentor_employee_id_fkey(first_name, last_name), employee:employees!employee_onboarding_employee_id_fkey(first_name, last_name, hire_date, status, departments(name))").order("started_on", { ascending: false }),
    supabase.from("onboarding_tasks").select("employee_id, due_on, done_at"),
    supabase.from("employees").select("id, first_name, last_name, hire_date, departments(name)").neq("status", "terminated").gte("hire_date", since).order("hire_date", { ascending: false }),
    supabase.from("onboarding_items").select("id, company_id, phase, title, owner, sort, active").eq("active", true).order("sort"),
    supabase.from("employees").select("id, first_name, last_name").neq("status", "terminated").order("first_name"),
  ]);
  if (error) return (<><PageHeader title="Uyum süreci" /><div className="p-6"><Card><p className="text-sm">Bu modül için Supabase&apos;de <b>20261111000000_onboarding.sql</b> çalıştırılmalı.</p></Card></div></>);
  type Emp = { first_name: string; last_name: string; hire_date: string | null; status: string; departments: { name: string } | null };
  const started = new Set((ob ?? []).map((o) => o.employee_id));
  const notStarted = (recent ?? []).filter((e) => !started.has(e.id));
  const active = (ob ?? []).filter((o) => { const e = o.employee as unknown as Emp | null; return e && e.status !== "terminated" && (o.probation_decision === null || days(o.started_on, today) <= 100); });
  const own = (items ?? []).some((i) => i.company_id);
  const template = (items ?? []).filter((i) => (own ? i.company_id : !i.company_id));

  return (
    <>
      <PageHeader title="Uyum süreci" subtitle="Yeni başlayanların ilk gün, ilk hafta ve 30-60-90 gün kontrol listeleri · deneme süresi kararları" />
      <div className="p-4 md:p-6 flex flex-col gap-4 max-w-[1200px]">
        {notStarted.length > 0 && (
          <Card title={`Uyum süreci başlatılmamış yeni personel · ${notStarted.length}`}>
            <ul className="divide-y divide-[#EEF2F6]">
              {notStarted.map((e) => (
                <li key={e.id} className="py-2 flex flex-wrap items-center gap-2 justify-between">
                  <span className="text-sm"><b>{e.first_name} {e.last_name}</b> · {(e.departments as unknown as { name: string } | null)?.name ?? "—"} · işe giriş {e.hire_date ? formatDate(e.hire_date) : "—"}</span>
                  <form action={startOnboarding} className="flex gap-2 items-center">
                    <input type="hidden" name="employee_id" value={e.id} />
                    <select name="mentor" className={input} aria-label="Usta / mentor"><option value="">Mentor seçin (isteğe bağlı)</option>{(staff ?? []).filter((x) => x.id !== e.id).map((x) => <option key={x.id} value={x.id}>{x.first_name} {x.last_name}</option>)}</select>
                    <PendingSubmit className="h-10 px-3 rounded-[10px] bg-brand-700 text-white text-sm font-semibold">Başlat</PendingSubmit>
                  </form>
                </li>
              ))}
            </ul>
          </Card>
        )}

        <Card title={`Süreçteki personel · ${active.length}`}>
          {active.length === 0 && <p className="text-sm text-muted">Süreçte kimse yok.</p>}
          <div className="grid gap-3 md:grid-cols-2">
            {active.map((o) => {
              const e = o.employee as unknown as Emp;
              const m = o.mentor as unknown as { first_name: string; last_name: string } | null;
              const t = (tasks ?? []).filter((x) => x.employee_id === o.employee_id);
              const doneN = t.filter((x) => x.done_at).length;
              const late = t.filter((x) => !x.done_at && x.due_on < today).length;
              const pct = t.length ? Math.round((doneN / t.length) * 100) : 0;
              const left = o.probation_end ? days(today, o.probation_end) : null;
              return (
                <Link key={o.employee_id} href={`/uyum/${o.employee_id}`} className="rounded-xl border border-line p-3 flex flex-col gap-2 hover:border-brand-600">
                  <div className="flex justify-between gap-2"><b className="text-brand-800">{e.first_name} {e.last_name}</b><span className="text-xs text-muted">{e.departments?.name}</span></div>
                  <div className="h-2 rounded-full bg-[#EEF2F6] overflow-hidden" role="img" aria-label={`Yüzde ${pct} tamamlandı`}><div className="h-full bg-[#1A7F52] rounded-full" style={{ width: `${pct}%` }} /></div>
                  <div className="text-xs text-muted flex flex-wrap gap-x-3">
                    <span>{doneN}/{t.length} görev</span>
                    {late > 0 && <span className="text-bad font-semibold">{late} gecikmiş</span>}
                    <span>Mentor: {m ? `${m.first_name} ${m.last_name}` : "—"}</span>
                    <span className={o.probation_decision ? "text-ok font-semibold" : left !== null && left <= 14 ? "text-bad font-semibold" : ""}>
                      {o.probation_decision ? `Deneme kararı: ${o.probation_decision === "continue" ? "devam" : "sonlandır"}` : left === null ? "" : left < 0 ? `Deneme süresi ${-left} gün önce bitti, karar yok` : `Deneme süresi ${left} gün sonra bitiyor`}
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>
        </Card>

        <Card title="Kontrol listesi şablonu">
          <p className="text-xs text-muted">{own ? "Şirketinize özel liste." : "Varsayılan liste kullanılıyor; madde ekleyince şirketinize kopyalanır ve düzenlenebilir olur."} Değişiklikler yeni başlatılan süreçlere uygulanır.</p>
          {PHASES.map(([ph, label]) => (
            <div key={ph} className="flex flex-col gap-1">
              <div className="text-xs font-bold uppercase tracking-wide text-brand-600">{label}</div>
              <ul className="text-sm divide-y divide-[#EEF2F6]">
                {template.filter((i) => i.phase === ph).map((i) => (
                  <li key={i.id} className="py-1.5 flex gap-2 items-center"><span className="flex-1">{i.title}</span><span className="text-xs text-muted">{OWNER_LABEL[i.owner]}</span>{own && <form action={removeItem}><input type="hidden" name="id" value={i.id} /><button className="text-xs text-bad font-semibold" aria-label={`${i.title} maddesini kaldır`}>Kaldır</button></form>}</li>
                ))}
              </ul>
            </div>
          ))}
          <form action={addItem} className="flex flex-wrap gap-2 items-end text-sm">
            <select name="phase" className={input} aria-label="Aşama">{PHASES.map(([k]) => <option key={k} value={k}>{PHASE_LABEL[k]}</option>)}</select>
            <input name="title" required placeholder="Yeni madde" className={`${input} flex-1 min-w-[200px]`} />
            <select name="owner" className={input} aria-label="Sorumlu">{Object.entries(OWNER_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
            <PendingSubmit className="h-10 px-3 rounded-[10px] bg-brand-700 text-white font-semibold">Ekle</PendingSubmit>
          </form>
        </Card>
      </div>
    </>
  );
}
