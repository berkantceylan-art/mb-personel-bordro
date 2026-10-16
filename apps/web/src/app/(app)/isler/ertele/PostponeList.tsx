"use client";
import { Fragment, useMemo, useState } from "react";
import Link from "next/link";
import { PostponeForm } from "@/components/PostponeForm";

export type PJob = { id: string; no: number; patient: string | null; customer: string; due_date: string | null; delivery_time: string | null; status: string; postpone_count: number; late: boolean };

const ST: Record<string, string> = { open: "Açık", tryin: "Provada", ready: "Hazır" };

/** Bugün çıkacak / geciken işler: seç, topluca ertele */
export function PostponeList({ jobs, preselect }: { jobs: PJob[]; preselect?: string }) {
  const [sel, setSel] = useState<Set<string>>(() => new Set(preselect ? [preselect] : []));
  const [q, setQ] = useState("");
  const shown = useMemo(() => {
    const s = q.trim().toLocaleLowerCase("tr");
    return s ? jobs.filter((j) => `${j.no} ${j.patient ?? ""} ${j.customer}`.toLocaleLowerCase("tr").includes(s)) : jobs;
  }, [jobs, q]);
  const allOn = shown.length > 0 && shown.every((j) => sel.has(j.id));
  const toggle = (id: string) => setSel((x) => { const n = new Set(x); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const [view, setView] = useState<"grup" | "liste">("grup");
  const groups = useMemo(() => {
    const m = new Map<string, PJob[]>();
    for (const j of shown) m.set(j.customer, [...(m.get(j.customer) ?? []), j]);
    return [...m.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0], "tr"));
  }, [shown]);
  const setGroup = (js: PJob[], on: boolean) => setSel((x) => { const n = new Set(x); for (const j of js) { if (on) n.add(j.id); else n.delete(j.id); } return n; });
  const row = (j: PJob) => (
    <tr key={j.id} className={`border-t border-[#EEF2F6] ${sel.has(j.id) ? "bg-[#FFF7ED]" : ""}`} onClick={(e) => { if ((e.target as HTMLElement).closest("a,input")) return; toggle(j.id); }}>
      <td className="p-3"><input type="checkbox" checked={sel.has(j.id)} onChange={() => toggle(j.id)} aria-label={`#${j.no} seç`} className="w-5 h-5" /></td>
      <td className="p-3 font-bold"><Link href={`/isler/${j.id}`} className="text-brand-700">#{j.no}</Link></td>
      <td className="p-3">{j.customer}</td>
      <td className="p-3 text-muted">{j.patient ?? "—"}</td>
      <td className={`p-3 tabular-nums ${j.late ? "text-bad font-semibold" : ""}`}>
        {j.due_date ? j.due_date.split("-").reverse().join(".") : "—"}{j.delivery_time ? ` ${j.delivery_time}` : ""}
        {j.postpone_count > 0 && <span className="ml-2 text-[11px] font-semibold rounded-full bg-[#FFEDD5] text-[#9A3412] px-2 py-0.5">↻ {j.postpone_count}. erteleme</span>}
      </td>
      <td className="p-3"><span className="text-xs font-semibold rounded-md bg-[#EEF2F6] px-2 py-0.5">{ST[j.status] ?? j.status}</span></td>
    </tr>
  );

  return (
    <section className="rounded-[16px] border border-line bg-white">
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-3 border-b border-line bg-white/95 p-3 backdrop-blur rounded-t-[16px]">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="İş no, hasta, hekim ara" className="h-10 rounded-[10px] border border-[#D5DEE8] px-3 text-sm w-56" />
        <span className="text-sm text-muted">{sel.size ? `${sel.size} iş seçili` : "Ertelenecek işleri seçin"}</span>
        <div className="ml-auto"><PostponeForm ids={[...sel]} onDone={() => setSel(new Set())} /></div>
      </div>
      <div className="flex flex-wrap items-center gap-2 px-3 pt-3 text-sm">
        <span className="text-muted">Görünüm:</span>
        {([["grup", "Hekime göre grupla"], ["liste", "Düz liste"]] as const).map(([k, l]) => (
          <button key={k} type="button" onClick={() => setView(k)} className={`h-8 px-3 rounded-full text-xs font-semibold ${view === k ? "bg-brand-700 text-white" : "border border-line text-brand-700"}`}>{l}</button>
        ))}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted">
              <th className="p-3 w-10"><input type="checkbox" aria-label="Hepsini seç" checked={allOn} onChange={() => setSel((x) => { const n = new Set(x); for (const j of shown) { if (allOn) n.delete(j.id); else n.add(j.id); } return n; })} className="w-5 h-5" /></th>
              <th className="p-3">No</th><th className="p-3">Hekim / hastane</th><th className="p-3">Hasta</th><th className="p-3">Çıkış</th><th className="p-3">Durum</th>
            </tr>
          </thead>
          <tbody>
            {view === "liste" ? shown.map(row) : groups.map(([cust, js]) => {
              const on = js.every((j) => sel.has(j.id));
              const some = !on && js.some((j) => sel.has(j.id));
              return (
                <Fragment key={cust}>
                  <tr className="bg-[#F3F6F9] border-t border-line">
                    <td className="p-3"><input type="checkbox" checked={on} ref={(el) => { if (el) el.indeterminate = some; }} onChange={() => setGroup(js, !on)} aria-label={`${cust} tüm işleri`} className="w-5 h-5" /></td>
                    <td colSpan={5} className="p-3">
                      <div className="flex flex-wrap items-center gap-3">
                        <b>{cust}</b>
                        <span className="text-xs text-muted">{js.length} iş{js.some((j) => j.late) ? ` · ${js.filter((j) => j.late).length} geciken` : ""}</span>
                        <button type="button" onClick={() => { setSel(new Set(js.map((j) => j.id))); window.scrollTo({ top: 0, behavior: "smooth" }); }} className="ml-auto h-8 px-3 rounded-[10px] border border-[#F2C38B] bg-[#FFF7ED] text-xs font-semibold text-[#9A3412]">⏭ Bu hekimin tüm işlerini ertele</button>
                      </div>
                    </td>
                  </tr>
                  {js.map(row)}
                </Fragment>
              );
            })}
            {!shown.length && <tr><td colSpan={6} className="p-8 text-center text-muted">Bugün çıkacak ya da geciken açık iş yok.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}
