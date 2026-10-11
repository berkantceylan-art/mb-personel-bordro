import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { EmptyRow, KPI, Table, btnSecondary, inputCls, page, selectCls, td, tdNum } from "@/components/erp";
import { getSession, formatDate } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { dateOk, today } from "@/lib/fin";
import { REMAKE_REASON, minutes } from "@/lib/production";
import { RemakeInsights } from "../_parts/RemakeInsights";

export const dynamic = "force-dynamic";

const REASON_TR: Record<string, string> = { fit: "uyum", color: "renk", fracture: "kırık", margin: "kenar", occlusion: "kapanış", contact: "kontakt", doctor_change: "hekim değişikliği", lab_error: "lab hatası", other: "diğer" };

/** Üretim raporu: teknisyen verimi, istasyon yükü, yeniden yapım analizi, zamanında teslim, lot geri izleme */
export default async function ProductionReport({ searchParams }: { searchParams: Promise<{ bas?: string; bit?: string; malzeme?: string; lot?: string }> }) {
  const s = await getSession();
  if ((s.modules.production ?? 0) < 1 && !s.logistics) redirect("/");
  const sp = await searchParams;
  const t = today();
  const from = dateOk(sp.bas) ?? t.slice(0, 8) + "01";
  const to = dateOk(sp.bit) ?? t;
  const supabase = await createClient();
  const [{ data: ops }, { data: rem }, { data: stations }, { data: items }, trace] = await Promise.all([
    supabase.from("prd_job_ops").select("job_id, station_id, qty, std_minutes, work_minutes, finished_at, round, employee_id, employees(first_name, last_name), jobs(no, in_date, due_date, job_items(product_id, name))").eq("status", "done").gte("finished_at", `${from}T00:00:00+03:00`).lte("finished_at", `${to}T23:59:59+03:00`).limit(20000),
    supabase.from("prd_remakes").select("id, job_id, reason, station_id, chargeable, created_at, description, jobs(no, patient)").gte("created_at", `${from}T00:00:00+03:00`).lte("created_at", `${to}T23:59:59+03:00`).order("created_at", { ascending: false }).limit(2000),
    supabase.from("prd_stations").select("id, name, sort").order("sort"),
    supabase.from("stk_items").select("id, name, code").eq("track_lot", true).order("name").limit(2000),
    sp.malzeme && sp.lot ? supabase.rpc("prd_lot_trace", { p_item: sp.malzeme, p_lot: sp.lot.trim() }) : Promise.resolve({ data: null }),
  ]);
  const { data: sigs } = await supabase.rpc("prd_remake_signals", { p_days: 90 });
  const signals = (sigs ?? []) as { dimension: string; label: string; remakes: number; base: number; rate: number; overall: number; top_reason: string }[];
  type O = { job_id: string; station_id: string; qty: number; std_minutes: number | null; work_minutes: number | null; finished_at: string; round: number; employee_id: string | null; employees: { first_name: string; last_name: string } | null; jobs: { no: number; in_date: string; due_date: string | null } | null };
  const os = (ops ?? []) as unknown as O[];
  const rs = (rem ?? []) as unknown as { id: string; job_id: string; reason: string; station_id: string | null; chargeable: boolean; created_at: string; description: string | null; jobs: { no: number; patient: string | null } | null }[];
  const sName = new Map((stations ?? []).map((x) => [x.id as string, x.name as string]));
  // teknisyen
  const tech = new Map<string, { name: string; n: number; units: number; work: number; std: number }>();
  for (const o of os) {
    const k = o.employee_id ?? "—";
    const x = tech.get(k) ?? { name: o.employees ? `${o.employees.first_name} ${o.employees.last_name}` : "Atanmamış", n: 0, units: 0, work: 0, std: 0 };
    x.n++; x.units += o.qty; x.work += Number(o.work_minutes ?? 0); x.std += Number(o.std_minutes ?? 0);
    tech.set(k, x);
  }
  // istasyon
  const stn = new Map<string, { n: number; units: number; work: number }>();
  for (const o of os) { const x = stn.get(o.station_id) ?? { n: 0, units: 0, work: 0 }; x.n++; x.units += o.qty; x.work += Number(o.work_minutes ?? 0); stn.set(o.station_id, x); }
  // iş bazında son adım (bitiş) → teslim süresi ve zamanında oranı
  const lastByJob = new Map<string, O>();
  for (const o of os) { const p = lastByJob.get(o.job_id); if (!p || p.finished_at < o.finished_at) lastByJob.set(o.job_id, o); }
  const jobsDone = [...lastByJob.values()];
  const lead = jobsDone.map((o) => (new Date(o.finished_at).getTime() - new Date(o.jobs?.in_date ?? o.finished_at).getTime()) / 86400000).filter((d) => d >= 0);
  const onTime = jobsDone.filter((o) => o.jobs?.due_date && o.finished_at.slice(0, 10) <= o.jobs.due_date).length;
  const withDue = jobsDone.filter((o) => o.jobs?.due_date).length;
  const byReason = new Map<string, number>();
  for (const r of rs) byReason.set(r.reason, (byReason.get(r.reason) ?? 0) + 1);
  const bySource = new Map<string, number>();
  for (const r of rs) bySource.set(r.station_id ?? "—", (bySource.get(r.station_id ?? "—") ?? 0) + 1);
  const remakeJobs = new Set(rs.map((r) => r.job_id)).size;
  const tr = (trace.data ?? null) as { job_id: string; job_no: number; patient: string | null; customer: string | null; used_at: string; qty: number }[] | null;

  return (
    <>
      <PageHeader title="Üretim raporu" subtitle={`${formatDate(from)} – ${formatDate(to)}`} actions={<Link href="/uretim" className="text-sm font-semibold text-brand-700">← Pano</Link>} />
      <div className={page}>
        {signals.length > 0 && (
          <section className="rounded-[16px] border border-[#FECACA] bg-[#FFF5F5] p-4">
            <b className="text-bad">⚠ Otomatik kök neden sinyalleri (son 90 gün)</b>
            <p className="text-xs text-muted mb-2">Yeniden yapım oranı genel oranın en az 2 katı olan kümeler: teknisyen, istasyon, hekim, ürün ya da malzeme lotu.</p>
            <ul className="grid gap-1.5 sm:grid-cols-2 text-sm">{signals.map((x, i) => <li key={i} className="rounded-[10px] bg-white border border-line px-3 py-2"><span className="text-xs font-bold uppercase text-muted">{x.dimension}</span> <b>{x.label}</b><span className="block text-xs">{x.remakes}/{x.base} işte yeniden yapım · <b className="text-bad">%{x.rate}</b> (genel %{x.overall}) · en sık: {REASON_TR[x.top_reason] ?? x.top_reason}</span></li>)}</ul>
          </section>
        )}
        <RemakeInsights />
        <form className="flex flex-wrap gap-2 items-end">
          <input type="date" name="bas" defaultValue={from} className={`${inputCls} w-44`} aria-label="Başlangıç" />
          <input type="date" name="bit" defaultValue={to} className={`${inputCls} w-44`} aria-label="Bitiş" />
          <button className={btnSecondary}>Göster</button>
        </form>
        <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
          <KPI label="Biten iş" value={jobsDone.length} sub={`${os.length} istasyon adımı`} />
          <KPI label="Ortalama üretim süresi" value={lead.length ? `${(lead.reduce((a, b) => a + b, 0) / lead.length).toLocaleString("tr-TR", { maximumFractionDigits: 1 })} gün` : "—"} sub="geliş → son istasyon" />
          <KPI label="Zamanında" value={withDue ? `%${Math.round((onTime / withDue) * 100)}` : "—"} sub={`${onTime} / ${withDue} iş`} tone={withDue && onTime / withDue < 0.9 ? "bad" : "ok"} />
          <KPI label="Yeniden yapım" value={rs.length} sub={jobsDone.length ? `iş başına %${Math.round((remakeJobs / Math.max(1, jobsDone.length)) * 100)}` : undefined} tone={rs.length ? "bad" : undefined} />
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <Table head={["Teknisyen", "Adım", "Birim", "Çalışma", "Std süre", "Verim"]} min={520}>
            {[...tech.values()].sort((a, b) => b.units - a.units).map((x) => (
              <tr key={x.name}>
                <td className={td}>{x.name}</td>
                <td className={`${td} num`}>{x.n}</td>
                <td className={`${td} num`}>{x.units}</td>
                <td className={tdNum}>{minutes(x.work)}</td>
                <td className={tdNum}>{x.std ? minutes(x.std) : "—"}</td>
                <td className={`${tdNum} ${x.std && x.work && x.std / x.work < 0.8 ? "text-bad" : "text-ok"}`}>{x.std && x.work ? `%${Math.round((x.std / x.work) * 100)}` : "—"}</td>
              </tr>
            ))}
            {tech.size === 0 && <EmptyRow cols={6} />}
          </Table>
          <Table head={["İstasyon", "Adım", "Birim", "Ort. süre / birim"]} min={420}>
            {(stations ?? []).filter((x) => stn.has(x.id as string)).map((x) => {
              const v = stn.get(x.id as string)!;
              return <tr key={x.id}><td className={td}>{x.name}</td><td className={`${td} num`}>{v.n}</td><td className={`${td} num`}>{v.units}</td><td className={tdNum}>{v.units ? minutes(v.work / v.units) : "—"}</td></tr>;
            })}
            {stn.size === 0 && <EmptyRow cols={4} />}
          </Table>
        </div>
        <div className="grid gap-4 lg:grid-cols-[1fr_1fr_1.4fr]">
          <Table head={["Neden", "Adet"]} min={260}>
            {[...byReason.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => <tr key={k}><td className={td}>{REMAKE_REASON[k] ?? k}</td><td className={`${td} num`}>{v}</td></tr>)}
            {byReason.size === 0 && <EmptyRow cols={2} text="Yeniden yapım yok." />}
          </Table>
          <Table head={["Hata kaynağı", "Adet"]} min={260}>
            {[...bySource.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => <tr key={k}><td className={td}>{sName.get(k) ?? "Belirtilmedi"}</td><td className={`${td} num`}>{v}</td></tr>)}
            {bySource.size === 0 && <EmptyRow cols={2} text="—" />}
          </Table>
          <Table head={["Tarih", "İş", "Neden", "Not"]} min={420}>
            {rs.slice(0, 30).map((r) => <tr key={r.id}><td className={td}>{formatDate(r.created_at)}</td><td className={td}><Link href={`/isler/${r.job_id}`} className="text-brand-700 font-semibold">#{r.jobs?.no}</Link></td><td className={td}>{REMAKE_REASON[r.reason]}{r.chargeable ? " · ücretli" : ""}</td><td className={td}>{r.description ?? ""}</td></tr>)}
            {rs.length === 0 && <EmptyRow cols={4} text="—" />}
          </Table>
        </div>

        <section className="bg-white border border-line rounded-[14px] p-4 flex flex-col gap-3">
          <h2 className="font-semibold">Lot geri izleme <span className="text-xs font-normal text-muted">(üretici geri çağırma / MDR izlenebilirlik)</span></h2>
          <form className="flex flex-wrap gap-2 items-end">
            <select name="malzeme" defaultValue={sp.malzeme ?? ""} className={`${selectCls} w-72`} aria-label="Malzeme"><option value="">Lot takipli malzeme</option>{(items ?? []).map((i) => <option key={i.id} value={i.id}>{i.name} · {i.code}</option>)}</select>
            <input name="lot" defaultValue={sp.lot ?? ""} placeholder="Lot no" className={`${inputCls} w-48`} />
            <input type="hidden" name="bas" value={from} /><input type="hidden" name="bit" value={to} />
            <button className={btnSecondary}>Ara</button>
          </form>
          {tr && (
            <Table head={["İş", "Hasta", "Hekim", "Kullanım", "Miktar"]} min={560}>
              {tr.map((x, i) => <tr key={i}><td className={td}><Link href={`/isler/${x.job_id}`} className="text-brand-700 font-semibold">#{x.job_no}</Link></td><td className={td}>{x.patient ?? ""}</td><td className={td}>{x.customer ?? ""}</td><td className={td}>{formatDate(x.used_at)}</td><td className={`${td} num`}>{Number(x.qty).toLocaleString("tr-TR")}</td></tr>)}
              {tr.length === 0 && <EmptyRow cols={5} text="Bu lot hiçbir işte kullanılmamış." />}
            </Table>
          )}
        </section>
      </div>
    </>
  );
}
