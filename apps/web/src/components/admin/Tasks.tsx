"use client";
import Link from "next/link";
import { useState } from "react";
import { useActionForm } from "@/lib/use-action-form";
import { taskCreate, taskSet } from "@/lib/admin-actions";

export type Person = { user_id: string; name: string };
export type Task = { id: string; title: string; note: string | null; link: string | null; assignee: string | null; assignee_name: string; due: string | null; status: "open" | "done" | "dismissed"; created_at: string; by: string; done_at: string | null; done_note: string | null; overdue: boolean };
const dt = (s: string | null) => (s ? s.slice(0, 10).split("-").reverse().join(".") : "");
const inp = "h-9 rounded-lg border border-[#D5DEE8] bg-white px-2 text-sm";

/** Bulguyu sorumluya görev olarak ata */
export function TaskAssign({ title, link, rule, people }: { title: string; link?: string; rule?: string; people: Person[] }) {
  const [open, setOpen] = useState(false);
  const { state, pending, formProps } = useActionForm(taskCreate, { onSuccess: () => setOpen(false) });
  return (
    <div className="flex flex-col gap-1.5">
      {!open && <button type="button" onClick={() => setOpen(true)} className="self-start h-9 px-3 rounded-lg border border-[#D5DEE8] bg-white text-sm font-semibold">📌 Görev ata</button>}
      {open && (
        <form {...formProps} className="flex flex-wrap items-center gap-1.5 rounded-lg bg-[#F7F9FB] p-2">
          <input type="hidden" name="link" value={link ?? ""} />
          <input type="hidden" name="rule" value={rule ?? ""} />
          <input name="title" defaultValue={title} required maxLength={200} aria-label="Görev" className={`${inp} flex-1 min-w-[180px]`} />
          <select name="assignee" required defaultValue="" aria-label="Sorumlu" className={inp}>
            <option value="">Sorumlu seçin</option>
            {people.map((p) => <option key={p.user_id} value={p.user_id}>{p.name}</option>)}
          </select>
          <input type="date" name="due" aria-label="Son gün" className={inp} />
          <input name="note" maxLength={300} placeholder="Not (isteğe bağlı)" aria-label="Not" className={`${inp} flex-1 min-w-[140px]`} />
          <button disabled={pending} className="h-9 px-3 rounded-lg bg-brand-700 text-white text-sm font-semibold disabled:opacity-50">{pending ? "…" : "Ata"}</button>
          <button type="button" onClick={() => setOpen(false)} className="h-9 px-2 text-sm text-muted">Vazgeç</button>
        </form>
      )}
      {state && <p role="status" className={`text-xs ${state.ok ? "text-ok" : "text-bad"}`}>{state.message}</p>}
    </div>
  );
}

function TaskRow({ t, admin }: { t: Task; admin: boolean }) {
  const { state, pending, formProps } = useActionForm(taskSet);
  const done = t.status !== "open";
  return (
    <li className={`py-2.5 flex flex-col gap-1 ${done ? "opacity-60" : ""}`}>
      <div className="flex items-start gap-2">
        <span className="mt-0.5">{t.status === "done" ? "✅" : t.status === "dismissed" ? "⛔" : t.overdue ? "⏰" : "📌"}</span>
        <div className="flex-1 min-w-0">
          {t.link ? <Link href={t.link} className={`text-sm font-semibold text-brand-800 hover:underline ${done ? "line-through" : ""}`}>{t.title}</Link> : <b className={`text-sm ${done ? "line-through" : ""}`}>{t.title}</b>}
          <span className="block text-xs text-muted">{admin ? `${t.assignee_name} · ` : `${t.by} atadı · `}{t.due ? <span className={t.overdue ? "text-bad font-semibold" : ""}>son gün {dt(t.due)}</span> : "son gün yok"}{t.note ? ` · ${t.note}` : ""}{t.done_note ? ` · ✔ ${t.done_note}` : ""}</span>
        </div>
      </div>
      <form {...formProps} className="flex flex-wrap gap-1.5 pl-6">
        <input type="hidden" name="id" value={t.id} />
        {!done && <input name="note" maxLength={200} placeholder="Ne yapıldı? (isteğe bağlı)" aria-label="Not" className="h-8 flex-1 min-w-[120px] rounded-lg border border-[#D5DEE8] px-2 text-xs" />}
        {!done && <button name="status" value="done" disabled={pending} className="h-8 px-2.5 rounded-lg bg-ok text-white text-xs font-semibold disabled:opacity-50">Tamamlandı</button>}
        {!done && admin && <button name="status" value="dismissed" disabled={pending} className="h-8 px-2.5 rounded-lg border border-[#D5DEE8] text-xs">Kapat</button>}
        {done && <button name="status" value="open" disabled={pending} className="h-8 px-2.5 rounded-lg border border-[#D5DEE8] text-xs">Yeniden aç</button>}
      </form>
      {state && !state.ok && <p role="status" className="text-xs text-bad pl-6">{state.message}</p>}
    </li>
  );
}

export function TaskList({ tasks, admin, empty = "Açık görev yok." }: { tasks: Task[]; admin: boolean; empty?: string }) {
  return (
    <ul className="divide-y divide-[#EEF2F6]">
      {tasks.map((t) => <TaskRow key={t.id} t={t} admin={admin} />)}
      {!tasks.length && <li className="py-3 text-sm text-muted">{empty}</li>}
    </ul>
  );
}
