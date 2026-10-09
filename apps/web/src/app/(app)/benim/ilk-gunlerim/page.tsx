import { Card } from "@/components/ui";
import { OWNER_LABEL, PHASES, PHASE_LABEL } from "@/lib/onboarding";
import { formatPhone } from "@/lib/recruiting";
import { formatDate, todayIso } from "@/lib/session";
import { toggleTask } from "../../uyum/actions";
import { me, MyHeader, NotLinked } from "../_shared";

type Mine = { started_on: string; probation_end: string | null; welcome_note: string | null; mentor_name: string | null; mentor_phone: string | null };
type MTask = { id: string; employee_name: string; phase: string; title: string; due_on: string; done_at: string | null };

/** Personelin uyum ekranı: kendi kontrol listesi ve mentorluk yaptığı kişilerin görevleri */
export default async function MyFirstDaysPage() {
  const { supabase, me: e } = await me();
  if (!e) return <NotLinked title="İlk günlerim" />;
  const [{ data: mine }, { data: tasks }, { data: mentee }] = await Promise.all([
    supabase.rpc("my_onboarding"),
    supabase.from("onboarding_tasks").select("id, phase, title, description, owner, due_on, done_at").eq("employee_id", e.id).order("sort"),
    supabase.rpc("my_mentee_tasks"),
  ]);
  const o = (mine as Mine[] | null)?.[0];
  const today = todayIso();
  const list = tasks ?? [];
  const done = list.filter((t) => t.done_at).length;
  const mtasks = (mentee ?? []) as MTask[];
  const Check = ({ id, isDone, label, can }: { id: string; isDone: boolean; label: string; can: boolean }) => can ? (
    <form action={toggleTask}><input type="hidden" name="id" value={id} /><input type="hidden" name="done" value={isDone ? "0" : "1"} />
      <button aria-label={isDone ? `${label}: geri al` : `${label}: tamamladım`} className={`w-8 h-8 rounded-md border-2 grid place-items-center ${isDone ? "bg-[#1A7F52] border-[#1A7F52] text-white" : "border-[#9FB3C8] bg-white"}`}>{isDone ? "✓" : ""}</button></form>
  ) : <span aria-hidden className={`w-8 h-8 rounded-md grid place-items-center ${isDone ? "bg-[#E6F4EC] text-ok" : "bg-[#EEF2F6]"}`}>{isDone ? "✓" : ""}</span>;

  return (
    <>
      <MyHeader title="İlk günlerim" subtitle={o ? `${done}/${list.length} adım tamamlandı` : "Uyum süreci"} />
      <div className="p-4 md:p-6 flex flex-col gap-4 max-w-[760px]">
        {!o && mtasks.length === 0 && <Card><p className="text-sm text-muted">Sizin için başlatılmış bir uyum süreci yok.</p></Card>}
        {o && (
          <div className="rounded-[14px] bg-brand-900 text-white p-4 flex flex-col gap-2">
            <div className="font-display text-lg font-bold">Aramıza hoş geldiniz, {e.first_name}!</div>
            {o.welcome_note && <p className="text-sm text-white/85 whitespace-pre-line">{o.welcome_note}</p>}
            <div className="text-sm text-white/85">{o.mentor_name ? <>Ustanız: <b className="text-white">{o.mentor_name}</b>{o.mentor_phone ? <> · <a href={`tel:${o.mentor_phone}`} className="underline text-white">{formatPhone(o.mentor_phone)}</a></> : null}</> : "Ustanız yakında atanacak."}</div>
            {o.probation_end && <div className="text-xs text-white/70">Deneme süreniz {formatDate(o.probation_end)} tarihinde bitiyor.</div>}
          </div>
        )}
        {o && PHASES.map(([ph, label]) => {
          const xs = list.filter((t) => t.phase === ph);
          if (!xs.length) return null;
          return (
            <Card key={ph} title={`${label} · ${xs.filter((t) => t.done_at).length}/${xs.length}`}>
              <ul className="divide-y divide-[#EEF2F6]">
                {xs.map((t) => (
                  <li key={t.id} className="py-2.5 flex gap-3 items-start">
                    <Check id={t.id} isDone={!!t.done_at} label={t.title} can={t.owner === "employee"} />
                    <div className="flex-1">
                      <div className={`text-[15px] ${t.done_at ? "text-muted line-through" : "font-medium"}`}>{t.title}</div>
                      <div className="text-xs text-muted">{t.owner === "employee" ? "Sizin adımınız" : OWNER_LABEL[t.owner]}{!t.done_at && t.due_on < today ? " · gecikti" : !t.done_at ? ` · ${formatDate(t.due_on)}` : ""}{t.description ? ` · ${t.description}` : ""}</div>
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          );
        })}
        {mtasks.length > 0 && (
          <Card title="Ustası olduğum kişiler">
            <ul className="divide-y divide-[#EEF2F6]">
              {mtasks.map((t) => (
                <li key={t.id} className="py-2.5 flex gap-3 items-start">
                  <Check id={t.id} isDone={!!t.done_at} label={t.title} can />
                  <div className="flex-1"><div className={`text-[15px] ${t.done_at ? "text-muted line-through" : "font-medium"}`}>{t.title}</div><div className="text-xs text-muted">{t.employee_name} · {PHASE_LABEL[t.phase]}{!t.done_at ? ` · ${formatDate(t.due_on)}` : ""}</div></div>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </>
  );
}
