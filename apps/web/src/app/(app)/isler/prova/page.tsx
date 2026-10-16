import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { getSession, todayIso } from "@/lib/session";
import { ProvaBoard, type PEntry } from "./ProvaBoard";

export const dynamic = "force-dynamic";
export const metadata = { title: "Prova / teslim merkezi" };

type Step = { id: string; kind: string; out_date: string | null; back_date: string | null; delivery_method: string | null; delivery_time: string | null; jobs: { id: string; no: number; patient: string | null; doctor_name: string | null; customer_id: string | null; status: string; flow_stage: string | null; postpone_count: number | null } | null };
type Job = { id: string; no: number; patient: string | null; doctor_name: string | null; customer_id: string | null; due_date: string; delivery_time: string | null; delivery_method: string | null; status: string; flow_stage: string | null; postpone_count: number | null };

/** Prova / teslim merkezi: gecikenler, bugün, önümüzdeki günler; hazırlık durumu, risk, hekim özeti, filtreler */
export default async function TryInCenter({ searchParams }: { searchParams: Promise<{ gun?: string }> }) {
  const s = await getSession();
  if (!s.logistics) redirect("/");
  const sp = await searchParams;
  const today = todayIso();
  const days = Math.min(30, Math.max(1, Number(sp.gun) || 7));
  const until = new Date(Date.parse(`${today}T12:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
  const sb = await createClient();
  // postpone_count yoksa (erteleme SQL'i çalışmamışsa) onsuz sorgula
  const load = (pc: boolean) => Promise.all([
    sb.from("job_steps").select(`id, kind, out_date, back_date, delivery_method, delivery_time, jobs(id, no, patient, doctor_name, customer_id, status, flow_stage${pc ? ", postpone_count" : ""})`).eq("done", false).lte("out_date", until).order("out_date").limit(3000),
    sb.from("jobs").select(`id, no, patient, doctor_name, customer_id, due_date, delivery_time, delivery_method, status, flow_stage${pc ? ", postpone_count" : ""}`).in("status", ["open", "tryin", "ready"]).lte("due_date", until).order("due_date").limit(3000),
  ]);
  let [r1, r2] = await load(true);
  if (/postpone_count/.test(r1.error?.message ?? "") || /postpone_count/.test(r2.error?.message ?? "")) [r1, r2] = await load(false);
  const { data: st, error } = r1, { data: due } = r2;
  const [{ data: back }, { data: cs }] = await Promise.all([
    sb.from("jobs").select("id, no, patient, customer_id, flow_stage, status").eq("flow_stage", "tryin").in("status", ["open", "tryin"]).limit(1000),
    sb.from("lab_customers").select("id, name, phone"),
  ]);
  const names = new Map(((cs ?? []) as { id: string; name: string }[]).map((c) => [c.id, c.name]));
  const entries: PEntry[] = [];
  for (const r of (st ?? []) as unknown as Step[]) {
    if (!r.jobs || !r.out_date || ["delivered", "cancelled"].includes(r.jobs.status)) continue;
    entries.push({ key: `s${r.id}`, type: "prova", label: r.kind, date: r.out_date, back: r.back_date, time: r.delivery_time, method: r.delivery_method, jobId: r.jobs.id, no: r.jobs.no, patient: r.jobs.patient, doctor: r.jobs.doctor_name,
      customerId: r.jobs.customer_id ?? "", customer: names.get(r.jobs.customer_id ?? "") ?? "—", stage: r.jobs.flow_stage ?? "reception", status: r.jobs.status, postponed: Number(r.jobs.postpone_count ?? 0), stepId: r.id });
  }
  for (const j of (due ?? []) as unknown as Job[]) {
    entries.push({ key: `j${j.id}`, type: "teslim", label: "Teslim", date: j.due_date, back: null, time: j.delivery_time, method: j.delivery_method, jobId: j.id, no: j.no, patient: j.patient, doctor: j.doctor_name,
      customerId: j.customer_id ?? "", customer: names.get(j.customer_id ?? "") ?? "—", stage: j.flow_stage ?? "reception", status: j.status, postponed: Number(j.postpone_count ?? 0) });
  }
  const atDoctor = ((back ?? []) as { id: string; no: number; patient: string | null; customer_id: string | null }[]).map((j) => ({ id: j.id, no: j.no, patient: j.patient, customer: names.get(j.customer_id ?? "") ?? "—" }));

  return (
    <>
      <PageHeader title="Prova / teslim merkezi" subtitle={`Gecikenler, bugün ve önümüzdeki ${days} gün · hazırlık durumu ve riskler`}
        actions={<span className="flex flex-wrap items-center gap-3 text-sm font-semibold">
          {[3, 7, 14].map((d) => <Link key={d} href={`/isler/prova?gun=${d}`} className={`h-9 px-3 inline-flex items-center rounded-full ${d === days ? "bg-brand-700 text-white" : "border border-line text-brand-700"}`}>{d} gün</Link>)}
          <a href={`/isler/prova/excel?gun=${days}`} className="text-brand-700">⬇ Excel</a>
          <Link href="/isler/ertele" className="text-[#9A3412]">⏭ İş erteleme</Link>
          <Link href="/isler" className="text-brand-700">İş listesi</Link>
        </span>} />
      <div className="p-4 md:p-6 flex flex-col gap-4 max-w-[1300px]">
        {error && <p className="text-sm text-bad bg-bad-bg rounded-lg p-3">{error.message}</p>}
        <ProvaBoard today={today} entries={entries} atDoctor={atDoctor} />
      </div>
    </>
  );
}
