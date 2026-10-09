import { PendingSubmit } from "@/components/ConfirmSubmit";
import { Card } from "@/components/ui";
import { LEVELS, LEVEL_STYLE } from "@/lib/performance";
import { formatDate } from "@/lib/session";
import { updateMyGoal } from "../../performans/actions";
import { me, MyHeader, NotLinked } from "../_shared";

/** Personel: hedeflerim ve beceri seviyelerim */
export default async function MyGoalsPage() {
  const { supabase, me: e } = await me();
  if (!e) return <NotLinked title="Hedef ve becerilerim" />;
  const [{ data: goals }, { data: dGoals }, { data: skills }] = await Promise.all([
    supabase.from("goals").select("id, title, description, due_on, progress, status, last_note").eq("employee_id", e.id).neq("status", "cancelled").order("due_on"),
    e.department_id ? supabase.from("goals").select("id, title, progress, due_on").eq("department_id", e.department_id).eq("status", "open") : Promise.resolve({ data: [] as Array<{ id: string; title: string; progress: number; due_on: string | null }> }),
    supabase.from("employee_skills").select("level, target_level, skills(name, category)").eq("employee_id", e.id).order("level", { ascending: false }),
  ]);
  return (
    <>
      <MyHeader title="Hedef ve becerilerim" />
      <div className="p-4 md:p-6 flex flex-col gap-4 max-w-[760px]">
        <Card title="Hedeflerim">
          {(goals ?? []).length === 0 && <p className="text-sm text-muted">Size atanmış hedef yok.</p>}
          {(goals ?? []).map((g) => (
            <div key={g.id} className="border-b border-[#EEF2F6] last:border-0 pb-3 flex flex-col gap-2">
              <div className="flex justify-between gap-2"><b className={g.status === "done" ? "line-through text-muted" : ""}>{g.title}</b><span className="num text-sm">%{g.progress}</span></div>
              {g.description && <p className="text-sm text-muted">{g.description}</p>}
              <div className="h-2 rounded-full bg-[#EEF2F6] overflow-hidden" role="img" aria-label={`Yüzde ${g.progress}`}><div className="h-full bg-[#1A7F52] rounded-full" style={{ width: `${g.progress}%` }} /></div>
              {g.due_on && <div className="text-xs text-muted">Son tarih {formatDate(g.due_on)}</div>}
              {g.status === "open" && (
                <form action={updateMyGoal} className="flex flex-wrap gap-2 items-end">
                  <input type="hidden" name="id" value={g.id} />
                  <label className="flex flex-col gap-1 text-xs text-muted">İlerleme %<input name="progress" type="number" min={0} max={100} defaultValue={g.progress} className="h-11 w-24 rounded-[10px] border border-[#D5DEE8] px-2 text-base" /></label>
                  <label className="flex flex-col gap-1 text-xs text-muted flex-1 min-w-[160px]">Not<input name="note" defaultValue={g.last_note ?? ""} className="h-11 rounded-[10px] border border-[#D5DEE8] px-2 text-base" /></label>
                  <PendingSubmit className="h-11 px-4 rounded-[10px] bg-brand-700 text-white font-semibold">Güncelle</PendingSubmit>
                </form>
              )}
            </div>
          ))}
        </Card>
        {(dGoals ?? []).length > 0 && (
          <Card title="Bölümümün hedefleri">
            <ul className="text-sm divide-y divide-[#EEF2F6]">{(dGoals ?? []).map((g) => <li key={g.id} className="py-1.5 flex justify-between gap-2"><span>{g.title}</span><span className="num">%{g.progress}</span></li>)}</ul>
          </Card>
        )}
        <Card title="Becerilerim">
          {(skills ?? []).length === 0 && <p className="text-sm text-muted">Beceri seviyeleriniz henüz girilmedi.</p>}
          <ul className="flex flex-col gap-1.5">
            {(skills ?? []).map((x, i) => {
              const k = x.skills as unknown as { name: string; category: string } | null;
              return <li key={i} className="flex justify-between items-center gap-2 text-sm"><span>{k?.name}</span><span className={`text-xs rounded px-2 py-0.5 ${LEVEL_STYLE[x.level]}`}>{LEVELS[x.level]}{x.target_level != null && x.target_level > x.level ? ` → ${LEVELS[x.target_level]}` : ""}</span></li>;
            })}
          </ul>
        </Card>
      </div>
    </>
  );
}
