import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { EmptyRow, Notice, Table, btnSecondary, inputCls, page, selectCls, td, tdNum } from "@/components/erp";
import { getSession, formatDate } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { FLOW_ACTION, FLOW_STAGE, since } from "@/lib/flow";
import { AutoRefresh } from "../_parts/AutoRefresh";

export const dynamic = "force-dynamic";

type J = { id: string; no: number; patient: string | null; doctor_name: string | null; customer_id: string | null; customer: string | null; in_date: string; due_date: string | null; status: string; flow_stage: string; holder_id: string | null; holder: string | null; holder_since: string | null; qty: number; last_action: string | null; last_at: string | null; last_by: string | null; rejects: number };

/** İş nerede: açık her iş hangi aşamada, kimin elinde, ne zamandır */
export default async function WherePage({ searchParams }: { searchParams: Promise<{ ara?: string; asama?: string; kim?: string; hekim?: string; gec?: string; risk?: string }> }) {
  const s = await getSession();
  if ((s.modules.production ?? 0) < 1 && !s.logistics) redirect("/");
  const sp = await searchParams;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("prd_open_jobs");
  const all = (data ?? []) as J[];
  const { data: rd } = await supabase.rpc("prd_delay_risk");
  const risk = new Map(((rd ?? []) as { job_id: string; risk: string; eta: string; slack_hours: number }[]).map((r) => [r.job_id, r]));
  const t = new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10);
  const q = (sp.ara ?? "").trim().toLocaleLowerCase("tr").replace(/^is/i, "");
  const rows = all.filter((j) =>
    (!q || String(j.no).includes(q) || (j.patient ?? "").toLocaleLowerCase("tr").includes(q) || (j.customer ?? "").toLocaleLowerCase("tr").includes(q) || (j.doctor_name ?? "").toLocaleLowerCase("tr").includes(q))
    && (!sp.asama || j.flow_stage === sp.asama) && (!sp.kim || j.holder_id === sp.kim) && (!sp.hekim || j.customer_id === sp.hekim) && (!sp.gec || (j.due_date && j.due_date < t)) && (!sp.risk || ["high", "late"].includes(risk.get(j.id)?.risk ?? "")));
  const stages = Object.keys(FLOW_STAGE).filter((k) => k !== "out");
  const holders = [...new Map(all.filter((j) => j.holder_id).map((j) => [j.holder_id!, j.holder!])).entries()].sort((a, b) => a[1].localeCompare(b[1], "tr"));
  const customers = [...new Map(all.filter((j) => j.customer_id).map((j) => [j.customer_id!, j.customer ?? ""])).entries()].sort((a, b) => a[1].localeCompare(b[1], "tr"));
  const single = q && rows.length === 1 ? rows[0] : null;
  const { data: tl } = single ? await supabase.rpc("prd_job_timeline", { p_job: single.id }) : { data: null };
  const qs = (patch: Record<string, string | undefined>) => { const u = new URLSearchParams(Object.entries({ ...sp, ...patch }).filter(([, v]) => v) as [string, string][]); return `/uretim/nerede${u.toString() ? `?${u}` : ""}`; };

  return (
    <>
      <PageHeader title="İş nerede?" subtitle={`${all.length} açık iş · ${all.reduce((x, j) => x + j.qty, 0)} birim · ${all.filter((j) => j.due_date && j.due_date < t).length} geciken`}
        actions={<span className="flex gap-4 text-sm font-semibold"><Link href="/uretim/okut" className="text-brand-700">Kutu okut</Link><Link href="/uretim/performans" className="text-brand-700">Performans</Link></span>} />
      <AutoRefresh seconds={60} />
      <div className={page}>
        {error && <Notice tone="bad">Supabase&apos;de 20261209000000_job_flow.sql çalıştırılmalı.</Notice>}
        <form className="flex flex-wrap gap-2">
          <input name="ara" defaultValue={sp.ara} autoFocus placeholder="İş no, hasta, hekim ara…" className={`${inputCls} flex-1 min-w-56 text-base`} />
          <select name="kim" defaultValue={sp.kim ?? ""} className={`${selectCls} w-48`} aria-label="Kimde"><option value="">Herkes</option>{holders.map(([id, n]) => <option key={id} value={id}>{n}</option>)}</select>
          <select name="hekim" defaultValue={sp.hekim ?? ""} className={`${selectCls} w-56`} aria-label="Hekim"><option value="">Tüm hekim / klinikler</option>{customers.map(([id, n]) => <option key={id} value={id}>{n}</option>)}</select>
          {sp.asama && <input type="hidden" name="asama" value={sp.asama} />}
          <button className={btnSecondary}>Ara</button>
        </form>

        <div className="grid gap-2 grid-cols-2 sm:grid-cols-3 lg:grid-cols-6">
          {stages.map((k) => {
            const n = all.filter((j) => j.flow_stage === k);
            const active = sp.asama === k;
            return (
              <Link key={k} href={qs({ asama: active ? undefined : k })} className={`rounded-[14px] border p-3 transition ${active ? "border-transparent text-white" : "border-line bg-white hover:border-brand-600"}`} style={active ? { background: FLOW_STAGE[k][1] } : undefined}>
                <span className="flex items-center gap-2 text-xs font-semibold"><span className="w-2 h-2 rounded-full" style={{ background: active ? "#fff" : FLOW_STAGE[k][1] }} />{FLOW_STAGE[k][0]}</span>
                <span className="block font-display text-2xl font-bold mt-1">{n.length}</span>
                <span className={`text-xs ${active ? "text-white/80" : "text-muted"}`}>{n.reduce((x, j) => x + j.qty, 0)} birim · {n.filter((j) => j.holder_id).length} elde</span>
              </Link>
            );
          })}
        </div>
        <div className="flex gap-3 text-sm"><Link href={qs({ gec: sp.gec ? undefined : "1" })} className={`font-semibold ${sp.gec ? "text-bad" : "text-brand-700"}`}>{sp.gec ? "✓ Yalnız gecikenler" : "Yalnız gecikenler"}</Link><Link href={qs({ risk: sp.risk ? undefined : "1" })} className={`font-semibold ${sp.risk ? "text-[#6D28D9]" : "text-brand-700"}`}>{sp.risk ? "✓ " : ""}✨ Gecikme riski olanlar ({[...risk.values()].filter((r) => r.risk === "high").length})</Link>{(sp.asama || sp.kim || sp.hekim || sp.ara || sp.gec || sp.risk) && <Link href="/uretim/nerede" className="text-muted">Filtreyi temizle</Link>}</div>

        {single && (
          <section className="bg-white border border-line rounded-[16px] p-4">
            <div className="flex flex-wrap items-baseline gap-3 mb-3"><Link href={`/isler/${single.id}`} className="font-display text-2xl font-bold text-brand-700">#{single.no}</Link><span>{single.patient}</span><span className="text-muted">{single.customer}</span></div>
            <ol className="relative border-l-2 border-[#D5DEE8] ml-2 flex flex-col gap-3">
              {((tl ?? []) as { at: string; action: string; stage: string; who: string | null; target: string | null; reason: string | null; minutes: number | null; station: string | null }[]).map((h, i) => (
                <li key={i} className="relative ml-4 text-sm">
                  <span className="absolute -left-[23px] top-1 w-3 h-3 rounded-full" style={{ background: FLOW_STAGE[h.stage === "chief" ? "chief" : h.stage === "qc" ? "qc" : h.stage === "dispatch" ? "dispatch" : "production"][1] }} />
                  <span className="text-muted num mr-2">{new Date(h.at).toLocaleString("tr-TR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
                  <b>{h.who ?? "Sistem"}</b> {FLOW_ACTION[h.action] ?? h.action}{h.station ? ` · ${h.station}` : ""}{h.minutes ? ` · ${h.minutes} dk` : ""}
                  {h.action === "reject" && <span className="block text-bad">{h.target ? `→ ${h.target}: ` : ""}{h.reason}</span>}
                </li>
              ))}
              {(tl ?? []).length === 0 && <li className="ml-4 text-sm text-muted">Henüz okutulmadı.</li>}
            </ol>
          </section>
        )}

        <Table head={["İş", "Hasta / hekim", "Aşama", "Şu an kimde", "Ne zamandır", "Son hareket", "Birim", "Teslim"]} min={1080}>
          {rows.map((j) => (
            <tr key={j.id}>
              <td className={td}><Link href={`/uretim/nerede?ara=${j.no}`} className="font-bold text-brand-700">#{j.no}</Link>{j.rejects > 0 && <span className="ml-1 text-[10px] font-semibold text-bad">↩{j.rejects}</span>}</td>
              <td className={td}>{j.patient ?? "—"}<span className="block text-xs text-muted">{j.customer ?? ""}{j.doctor_name ? ` · ${j.doctor_name}` : ""}</span></td>
              <td className={td}><span className="inline-flex items-center gap-1.5 text-xs font-semibold"><span className="w-2 h-2 rounded-full" style={{ background: FLOW_STAGE[j.flow_stage]?.[1] }} />{FLOW_STAGE[j.flow_stage]?.[0]}</span></td>
              <td className={td}>{j.holder ? <b>{j.holder}</b> : <span className="text-muted">sırada (kimsede değil)</span>}</td>
              <td className={td}>{since(j.holder_since)}</td>
              <td className={td}>{j.last_action ? <span className="text-xs">{j.last_by ?? ""} {FLOW_ACTION[j.last_action]}<span className="block text-muted">{since(j.last_at)} önce</span></span> : <span className="text-xs text-muted">okutulmadı</span>}</td>
              <td className={tdNum}>{j.qty}</td>
              <td className={`${td} ${j.due_date && j.due_date < t ? "text-bad font-semibold" : j.due_date === t ? "text-warn font-semibold" : ""}`}>{j.due_date ? formatDate(j.due_date) : "—"}{risk.get(j.id)?.risk === "high" && <span className="block text-[10px] font-bold text-[#6D28D9]" title={`Tahmini hazır: ${new Date(risk.get(j.id)!.eta).toLocaleString("tr-TR", { timeZone: "Europe/Istanbul" })}`}>✨ yetişmeyebilir</span>}{risk.get(j.id)?.risk === "medium" && <span className="block text-[10px] font-semibold text-warn">sıkışık</span>}</td>
            </tr>
          ))}
          {rows.length === 0 && <EmptyRow cols={8} text="Kayıt yok." />}
        </Table>
      </div>
    </>
  );
}
