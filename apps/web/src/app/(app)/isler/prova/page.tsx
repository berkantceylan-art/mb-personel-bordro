import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { formatDate, getSession, todayIso } from "@/lib/session";
import { toggleStep } from "../actions";

export const dynamic = "force-dynamic";

type Row = { id: string; kind: string; out_date: string | null; back_date: string | null; delivery_method: string | null; delivery_time: string | null; done: boolean; jobs: { id: string; no: number; patient: string | null; doctor_name: string | null; customer_id: string | null; status: string } | null };

/** Prova / teslim listesi: bekleyen prova adımları ve çıkış tarihi gelen işler, güne göre */
export default async function TryInList({ searchParams }: { searchParams: Promise<{ gun?: string }> }) {
  const s = await getSession();
  if (!s.logistics) redirect("/");
  const sp = await searchParams;
  const today = todayIso();
  const until = /^\d{4}-\d{2}-\d{2}$/.test(sp.gun ?? "") ? sp.gun! : new Date(Date.now() + (3 + 24 * 7) * 3600 * 1000).toISOString().slice(0, 10);
  const supabase = await createClient();
  const [{ data: st, error }, { data: due }, { data: cs }] = await Promise.all([
    supabase.from("job_steps").select("id, kind, out_date, back_date, delivery_method, delivery_time, done, jobs(id, no, patient, doctor_name, customer_id, status)").eq("done", false).lte("out_date", until).order("out_date").order("delivery_time"),
    supabase.from("jobs").select("id, no, patient, doctor_name, customer_id, due_date, delivery_time, delivery_method, status").in("status", ["open", "tryin", "ready"]).lte("due_date", until).order("due_date").order("delivery_time"),
    supabase.from("lab_customers").select("id, name"),
  ]);
  const names = new Map((cs ?? []).map((c) => [c.id as string, c.name as string]));
  type Entry = { key: string; date: string; time: string | null; label: string; method: string | null; jobId: string; no: number; patient: string | null; customer: string; stepId?: string };
  const entries: Entry[] = [];
  for (const r of (st ?? []) as unknown as Row[]) {
    if (!r.jobs || !r.out_date || ["delivered", "cancelled"].includes(r.jobs.status)) continue;
    entries.push({ key: `s${r.id}`, date: r.out_date, time: r.delivery_time, label: r.kind, method: r.delivery_method, jobId: r.jobs.id, no: r.jobs.no, patient: r.jobs.patient, customer: names.get(r.jobs.customer_id ?? "") ?? "—", stepId: r.id });
  }
  for (const j of due ?? []) {
    entries.push({ key: `j${j.id}`, date: j.due_date as string, time: j.delivery_time, label: "Teslim", method: j.delivery_method, jobId: j.id, no: j.no, patient: j.patient, customer: names.get(j.customer_id ?? "") ?? "—" });
  }
  entries.sort((a, b) => (a.date + (a.time ?? "99")).localeCompare(b.date + (b.time ?? "99")));
  const groups = new Map<string, Entry[]>();
  for (const e of entries) {
    const g = e.date < today ? "late" : e.date;
    groups.set(g, [...(groups.get(g) ?? []), e]);
  }
  const title = (g: string) => (g === "late" ? "Gecikmiş" : g === today ? `Bugün · ${formatDate(g)}` : formatDate(g));

  return (
    <>
      <PageHeader title="Prova / teslim listesi" subtitle="Önümüzdeki 7 gün ve gecikenler" actions={<span className="flex gap-3"><Link href="/isler/ertele" className="text-sm font-semibold text-[#9A3412]">⏭ İş erteleme</Link><Link href="/isler" className="text-sm font-semibold text-brand-700">İş listesi</Link></span>} />
      <div className="p-4 md:p-8 flex flex-col gap-6 max-w-[1000px]">
        {error && <p className="text-sm text-bad bg-bad-bg rounded-lg p-3">İş kayıt tabloları yok: Supabase&apos;de 20261125000000_lab_jobs.sql çalıştırın.</p>}
        {[...groups.entries()].map(([g, list]) => (
          <section key={g} className="flex flex-col gap-2">
            <h2 className={`font-display text-lg font-semibold ${g === "late" ? "text-bad" : "text-brand-800"}`}>{title(g)} <span className="text-sm text-muted font-normal">({list.length})</span></h2>
            <ul className="flex flex-col gap-2">
              {list.map((e) => (
                <li key={e.key} className="rounded-xl border border-line bg-white px-4 py-3 flex flex-wrap items-center gap-3">
                  <span className="num text-sm text-muted w-12">{e.time ?? ""}</span>
                  <span className={`text-xs font-bold px-2 py-0.5 rounded-md ${e.label === "Teslim" ? "bg-ok-bg text-ok" : "bg-warn-bg text-warn"}`}>{e.label}</span>
                  <Link href={`/isler/${e.jobId}`} className="font-semibold text-brand-700">#{e.no}</Link>
                  <span>{e.customer}</span>
                  <span className="text-muted">{e.patient ?? ""}</span>
                  {e.method && <span className="text-xs text-muted">· {e.method}</span>}
                  {(g === "late" || g === today) && <Link href={`/isler/ertele?is=${e.jobId}`} className={`${e.stepId ? "" : "ml-auto "}h-9 px-3 inline-flex items-center rounded-[10px] border border-[#F2C38B] bg-[#FFF7ED] text-sm font-semibold text-[#9A3412]`}>⏭ Ertele</Link>}
                  {e.stepId && (
                    <form action={toggleStep} className="ml-auto">
                      <input type="hidden" name="id" value={e.stepId} />
                      <input type="hidden" name="done" value="1" />
                      <button className="h-9 px-3 rounded-[10px] border border-[#D5DEE8] bg-white text-sm font-semibold text-ok">✓ Tamamlandı</button>
                    </form>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))}
        {entries.length === 0 && !error && <p className="text-muted">Önümüzdeki 7 günde prova ya da teslim yok.</p>}
      </div>
    </>
  );
}
