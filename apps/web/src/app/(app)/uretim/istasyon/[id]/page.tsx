import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { Chip } from "@/components/erp";
import { getSession, formatDate } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { today } from "@/lib/fin";
import { OP_STATUS, minutes } from "@/lib/production";
import { AutoRefresh } from "../../_parts/AutoRefresh";
import { StationTerminal } from "./StationTerminal";

export const dynamic = "force-dynamic";

/** İstasyon ekranı: okutma terminali + bu istasyonun kuyruğu + bugün bitenler */
export default async function StationPage({ params }: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if ((s.modules.production ?? 0) < 1 && !s.logistics) redirect("/");
  const { id } = await params;
  const supabase = await createClient();
  const { data: st } = await supabase.from("prd_stations").select("id, name, color").eq("id", id).maybeSingle();
  if (!st) notFound();
  const t = today();
  const [{ data: queue }, { data: doneToday }, { data: emps }] = await Promise.all([
    supabase.from("prd_job_ops").select("id, status, qty, std_minutes, started_at, round, jobs!inner(id, no, patient, due_date, status, lab_customers(name))").eq("station_id", id).in("status", ["ready", "in_progress", "paused", "waiting"]).not("jobs.status", "in", "(delivered,cancelled)").limit(300),
    supabase.from("prd_job_ops").select("id, qty, work_minutes, finished_at, employees(first_name, last_name), jobs(no, patient)").eq("station_id", id).eq("status", "done").gte("finished_at", `${t}T00:00:00+03:00`).order("finished_at", { ascending: false }).limit(100),
    supabase.from("employees").select("id, first_name, last_name").eq("status", "active").order("first_name"),
  ]);
  type Q = { id: string; status: string; qty: number; std_minutes: number | null; started_at: string | null; round: number; jobs: { id: string; no: number; patient: string | null; due_date: string | null; lab_customers: { name: string } | null } };
  const q = ((queue ?? []) as unknown as Q[]).sort((a, b) => ["in_progress", "paused", "ready", "waiting"].indexOf(a.status) - ["in_progress", "paused", "ready", "waiting"].indexOf(b.status) || (a.jobs.due_date ?? "9").localeCompare(b.jobs.due_date ?? "9"));
  const d = (doneToday ?? []) as unknown as { id: string; qty: number; work_minutes: number | null; finished_at: string; employees: { first_name: string; last_name: string } | null; jobs: { no: number; patient: string | null } | null }[];
  return (
    <>
      <PageHeader title={st.name} subtitle={`Bugün biten: ${d.length} iş · ${d.reduce((x, o) => x + o.qty, 0)} birim`} actions={<Link href="/uretim" className="text-sm font-semibold text-brand-700">← Pano</Link>} />
      <AutoRefresh seconds={45} />
      <div className="p-4 md:p-6 grid gap-5 lg:grid-cols-[1fr_420px] max-w-[1400px]">
        <StationTerminal stationId={st.id} employees={(emps ?? []).map((e) => ({ id: e.id, name: `${e.first_name} ${e.last_name}` }))} />
        <div className="flex flex-col gap-4">
          <section className="bg-white border border-line rounded-[14px]">
            <h2 className="px-4 py-3 border-b border-line font-semibold">Kuyruk ({q.length})</h2>
            <ul className="divide-y divide-[#EEF2F6] text-sm max-h-[55vh] overflow-y-auto">
              {q.map((o) => (
                <li key={o.id} className="px-4 py-2.5 flex items-center gap-3">
                  <Link href={`/isler/${o.jobs.id}`} className="font-semibold text-brand-700 w-20">#{o.jobs.no}{o.round > 1 ? <span className="text-[10px] text-bad ml-1">YY</span> : null}</Link>
                  <span className="flex-1 min-w-0 truncate">{o.jobs.patient ?? "—"}<span className="block text-xs text-muted truncate">{o.jobs.lab_customers?.name ?? ""} · {o.qty} birim</span></span>
                  <span className="text-right">
                    <Chip tone={OP_STATUS[o.status]?.[1]}>{OP_STATUS[o.status]?.[0]}</Chip>
                    {o.jobs.due_date && <span className={`block text-xs ${o.jobs.due_date < t ? "text-bad font-semibold" : "text-muted"}`}>{formatDate(o.jobs.due_date)}</span>}
                  </span>
                </li>
              ))}
              {q.length === 0 && <li className="px-4 py-6 text-center text-muted">Kuyruk boş.</li>}
            </ul>
          </section>
          <section className="bg-white border border-line rounded-[14px]">
            <h2 className="px-4 py-3 border-b border-line font-semibold">Bugün biten</h2>
            <ul className="divide-y divide-[#EEF2F6] text-sm max-h-[30vh] overflow-y-auto">
              {d.map((o) => <li key={o.id} className="px-4 py-2 flex gap-3"><span className="w-16 font-semibold">#{o.jobs?.no}</span><span className="flex-1 truncate">{o.jobs?.patient ?? ""}</span><span className="text-xs text-muted">{o.employees?.first_name ?? ""} · {minutes(o.work_minutes)}</span></li>)}
              {d.length === 0 && <li className="px-4 py-4 text-center text-muted">Henüz yok.</li>}
            </ul>
          </section>
        </div>
      </div>
    </>
  );
}
