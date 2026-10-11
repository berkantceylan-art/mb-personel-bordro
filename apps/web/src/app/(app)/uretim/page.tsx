import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { KPI, Notice } from "@/components/erp";
import { PendingSubmit } from "@/components/ConfirmSubmit";
import { getSession, formatDate } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { today } from "@/lib/fin";
import { opAction, planJob } from "@/lib/production-actions";
import { minutes } from "@/lib/production";
import { AutoRefresh } from "./_parts/AutoRefresh";

export const dynamic = "force-dynamic";

type Op = { id: string; job_id: string; station_id: string; status: string; qty: number; std_minutes: number | null; started_at: string | null; round: number; employees: { first_name: string; last_name: string } | null; jobs: { id: string; no: number; patient: string | null; doctor_name: string | null; due_date: string | null; status: string; lab_customers: { name: string } | null } | null };

/** Üretim panosu: her istasyonda bekleyen ve çalışılan işler */
export default async function ProductionBoard() {
  const s = await getSession();
  const lvl = Math.max(s.modules.production ?? 0, s.logistics ? 2 : 0);
  if (lvl < 1) redirect("/");
  const supabase = await createClient();
  const t = today();
  const monthStart = t.slice(0, 8) + "01";
  const [{ data: stations, error }, { data: ops }, { data: unplanned }, { count: remakes }] = await Promise.all([
    supabase.from("prd_stations").select("id, name, color, sort, daily_capacity").eq("is_active", true).order("sort"),
    supabase.from("prd_job_ops").select("id, job_id, station_id, status, qty, std_minutes, started_at, round, employees(first_name, last_name), jobs!inner(id, no, patient, doctor_name, due_date, status, lab_customers(name))")
      .in("status", ["ready", "in_progress", "paused"]).not("jobs.status", "in", "(delivered,cancelled)").limit(2000),
    supabase.from("jobs").select("id, no, patient, due_date, lab_customers(name), prd_job_ops(id)").in("status", ["open", "tryin"]).order("due_date").limit(300),
    supabase.from("prd_remakes").select("id", { count: "exact", head: true }).gte("created_at", monthStart),
  ]);
  const all = (ops ?? []) as unknown as Op[];
  const notPlanned = ((unplanned ?? []) as unknown as { id: string; no: number; patient: string | null; due_date: string | null; lab_customers: { name: string } | null; prd_job_ops: { id: string }[] }[]).filter((j) => j.prd_job_ops.length === 0);
  const inWork = new Set(all.map((o) => o.job_id));
  const late = all.filter((o) => o.jobs?.due_date && o.jobs.due_date < t);
  const dueToday = all.filter((o) => o.jobs?.due_date === t);
  const now = Date.now();
  const dueCls = (d: string | null | undefined) => (!d ? "text-muted" : d < t ? "text-bad font-semibold" : d === t ? "text-warn font-semibold" : "text-muted");

  return (
    <>
      <PageHeader title="Üretim panosu" subtitle="İşler istasyon istasyon: okutarak başla / bitir. Pano 30 saniyede bir tazelenir."
        actions={<span className="flex gap-4 text-sm font-semibold"><Link href="/uretim/rapor" className="text-brand-700">Rapor</Link><Link href="/uretim/ayarlar" className="text-brand-700">İstasyon ve rotalar</Link></span>} />
      <AutoRefresh />
      <div className="p-4 md:p-6 flex flex-col gap-4">
        {error && <Notice tone="bad">Üretim tabloları yok: Supabase&apos;de 20261207000000_production.sql çalıştırın.</Notice>}
        <div className="grid gap-3 grid-cols-2 md:grid-cols-4 max-w-[1320px]">
          <KPI label="Üretimdeki iş" value={inWork.size} />
          <KPI label="Teslimi geçmiş" value={new Set(late.map((o) => o.job_id)).size} tone={late.length ? "bad" : undefined} />
          <KPI label="Bugün teslim" value={new Set(dueToday.map((o) => o.job_id)).size} />
          <KPI label="Bu ay yeniden yapım" value={remakes ?? 0} href="/uretim/rapor" tone={(remakes ?? 0) > 0 ? "bad" : undefined} />
        </div>
        <div className="flex gap-3 overflow-x-auto pb-3 snap-x">
          {notPlanned.length > 0 && (
            <section className="snap-start shrink-0 w-72 bg-[#F1F4F8] rounded-[14px] p-2 flex flex-col gap-2">
              <header className="px-2 py-1 flex justify-between items-center"><b className="text-sm">Planlanmamış</b><span className="text-xs text-muted">{notPlanned.length}</span></header>
              {notPlanned.slice(0, 60).map((j) => (
                <div key={j.id} className="bg-white rounded-[10px] border border-line p-2.5 text-sm">
                  <div className="flex justify-between"><Link href={`/isler/${j.id}`} className="font-semibold text-brand-700">#{j.no}</Link><span className={`text-xs ${dueCls(j.due_date)}`}>{j.due_date ? formatDate(j.due_date) : ""}</span></div>
                  <span className="block truncate">{j.patient ?? "—"}</span>
                  <span className="block text-xs text-muted truncate">{j.lab_customers?.name ?? ""}</span>
                  {lvl >= 2 && <form action={planJob} className="mt-1.5"><input type="hidden" name="job_id" value={j.id} /><PendingSubmit className="text-xs font-semibold text-brand-700">Üretime al →</PendingSubmit></form>}
                </div>
              ))}
            </section>
          )}
          {(stations ?? []).map((st) => {
            const col = all.filter((o) => o.station_id === st.id).sort((a, b) => (a.status === "in_progress" ? -1 : 0) - (b.status === "in_progress" ? -1 : 0) || (a.jobs?.due_date ?? "9").localeCompare(b.jobs?.due_date ?? "9"));
            const load = col.reduce((x, o) => x + o.qty, 0);
            return (
              <section key={st.id} className="snap-start shrink-0 w-72 bg-[#F1F4F8] rounded-[14px] p-2 flex flex-col gap-2">
                <header className="px-2 py-1 flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ background: st.color ?? "#64748B" }} />
                  <Link href={`/uretim/istasyon/${st.id}`} className="text-sm font-bold hover:underline">{st.name}</Link>
                  <span className={`ml-auto text-xs ${st.daily_capacity && load > st.daily_capacity ? "text-bad font-semibold" : "text-muted"}`}>{col.length} iş · {load} birim{st.daily_capacity ? ` / ${st.daily_capacity}` : ""}</span>
                </header>
                {col.map((o) => {
                  const j = o.jobs!;
                  const el = o.started_at ? (now - new Date(o.started_at).getTime()) / 60000 : 0;
                  return (
                    <div key={o.id} className={`bg-white rounded-[10px] border p-2.5 text-sm ${o.status === "in_progress" ? "border-warn shadow-sm" : o.status === "paused" ? "border-bad" : "border-line"}`}>
                      <div className="flex justify-between gap-2"><Link href={`/isler/${j.id}`} className="font-semibold text-brand-700">#{j.no}{o.round > 1 && <span className="ml-1 text-[10px] text-bad">YY{o.round - 1}</span>}</Link><span className={`text-xs ${dueCls(j.due_date)}`}>{j.due_date ? formatDate(j.due_date) : ""}</span></div>
                      <span className="block truncate">{j.patient ?? "—"} <span className="text-xs text-muted">· {o.qty} birim</span></span>
                      <span className="block text-xs text-muted truncate">{j.lab_customers?.name ?? j.doctor_name ?? ""}</span>
                      {o.status === "in_progress" && <span className={`block text-xs mt-1 ${o.std_minutes && el > o.std_minutes ? "text-bad" : "text-warn"}`}>⏱ {minutes(el)}{o.std_minutes ? ` / std ${minutes(o.std_minutes)}` : ""}{o.employees ? ` · ${o.employees.first_name}` : ""}</span>}
                      {o.status === "paused" && <span className="block text-xs mt-1 text-bad">Durduruldu</span>}
                      {lvl >= 2 && (
                        <form action={opAction} className="mt-1.5 flex gap-3">
                          <input type="hidden" name="id" value={o.id} /><input type="hidden" name="job_id" value={j.id} />
                          {o.status !== "in_progress" && <PendingSubmit name="action" value="start" className="text-xs font-semibold text-brand-700">Başla</PendingSubmit>}
                          {o.status === "in_progress" && <PendingSubmit name="action" value="pause" className="text-xs font-semibold text-muted">Durdur</PendingSubmit>}
                          <PendingSubmit name="action" value="finish" className="text-xs font-semibold text-ok">Bitti →</PendingSubmit>
                        </form>
                      )}
                    </div>
                  );
                })}
                {col.length === 0 && <p className="text-xs text-muted text-center py-4">Boş</p>}
              </section>
            );
          })}
        </div>
      </div>
    </>
  );
}
