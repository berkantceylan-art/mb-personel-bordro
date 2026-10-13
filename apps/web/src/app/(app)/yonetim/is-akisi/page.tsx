import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import { JobFix, STAGES } from "./JobFix";

export const dynamic = "force-dynamic";
export const metadata = { title: "İş akışı denetimi" };

type Board = {
  stages: Array<{ stage: string; count: number; avg_hours: number | null; stuck: number; limit: number }>;
  jobs: Array<{ id: string; no: number; customer: string | null; patient: string | null; stage: string; holder: string | null; holder_name: string | null; hours: number; limit: number; due: string | null; in: string | null; flags: string[] }>;
  open_total: number;
  workload: Array<{ employee: string; name: string | null; count: number; stuck: number }>;
  people: Array<{ id: string; name: string; role: string }>;
  remakes: Array<{ job: string; no: number; customer: string | null; reason: string; at: string }>;
};
const FLAG: Record<string, [string, string]> = { stuck: ["Takıldı", "bg-[#FEE2E2] text-[#B91C1C]"], overdue: ["Gecikti", "bg-[#FEE2E2] text-[#B91C1C]"], due_soon: ["Yarın teslim", "bg-[#FEF3C7] text-[#B45309]"], no_holder: ["Sahipsiz", "bg-[#EDE9FE] text-[#6D28D9]"] };
const REASON: Record<string, string> = { fit: "Uyum", color: "Renk", fracture: "Kırık", margin: "Kenar", occlusion: "Kapanış", contact: "Kontakt", doctor_change: "Hekim değişikliği", lab_error: "Lab hatası", other: "Diğer" };
const dur = (h: number) => (h >= 48 ? `${Math.round(h / 24)} gün` : `${Math.round(h)} sa`);
const dt = (s: string | null) => (s ? s.slice(0, 10).split("-").reverse().join(".") : "—");

/** İş kaydından teslime: her aşamada takılan, sahipsiz, gecikmiş işler ve yönetici müdahalesi */
export default async function FlowAudit() {
  const s = await getSession();
  if (!(s.role === "owner" || (s.modules.users ?? 0) >= 3 || (s.modules.production ?? 0) >= 3 || (s.modules.lab ?? 0) >= 3)) redirect("/");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("adm_flow_board");
  if (error) {
    return (<><PageHeader title="İş akışı denetimi" /><div className="p-4 md:p-8"><p className="text-sm rounded-[12px] px-4 py-3 bg-warn-bg text-warn">{/adm_flow_board|does not exist/.test(error.message) ? "Supabase'de 20270126000000_admin_flow.sql çalıştırılmalı." : error.message}</p></div></>);
  }
  const b = data as Board;
  const stuck = b.stages.reduce((a, x) => a + x.stuck, 0);
  return (
    <>
      <PageHeader title="İş akışı denetimi" subtitle={`${b.open_total} açık iş · ${stuck} takılı · ${b.jobs.filter((j) => j.flags.includes("overdue")).length} gecikmiş · ${b.jobs.filter((j) => j.flags.includes("no_holder")).length} sahipsiz`}
        actions={<span className="flex gap-4 text-sm font-semibold"><Link href="/yonetim/kontrol" className="text-brand-700">← Kontrol Merkezi</Link><Link href="/uretim" className="text-brand-700">Üretim</Link></span>} />
      <div className="p-4 md:p-6 flex flex-col gap-5 max-w-[1320px]">
        <section className="rounded-[20px] p-4 md:p-5 bg-[linear-gradient(135deg,#0B1222,#16213E)] text-white">
          <p className="text-[11px] uppercase tracking-[.25em] text-white/50 mb-3">İş kaydından teslime akış</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
            {b.stages.map((st, i) => (
              <div key={st.stage} className={`relative rounded-2xl p-3 border ${st.stuck ? "border-[#F87171]/60 bg-[#7F1D1D]/30" : "border-white/10 bg-white/[.06]"}`}>
                <span className="text-[11px] text-white/50">{i + 1}. aşama</span>
                <b className="block text-sm">{STAGES[st.stage] ?? st.stage}</b>
                <b className="font-display text-3xl num">{st.count}</b>
                <span className="block text-[11px] text-white/60">ort. {st.avg_hours === null ? "—" : dur(st.avg_hours)} · sınır {dur(st.limit)}</span>
                {st.stuck > 0 && <span className="absolute top-2 right-2 text-[11px] font-bold px-1.5 py-0.5 rounded-full bg-[#EF4444]">{st.stuck} takılı</span>}
              </div>
            ))}
          </div>
        </section>

        <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
          <section className="bg-white border border-line rounded-[18px] overflow-hidden">
            <h2 className="px-4 py-3 border-b border-line font-display font-semibold text-brand-800">Müdahale bekleyen işler ({b.jobs.length})</h2>
            <ul className="divide-y divide-[#EEF2F6]">
              {b.jobs.map((j) => (
                <li key={j.id} className="px-4 py-3 flex flex-wrap gap-3">
                  <div className="flex-1 min-w-[240px]">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Link href={`/isler/${j.id}`} className="font-mono font-bold text-brand-700">#{j.no}</Link>
                      <b className="text-sm">{j.customer ?? "—"}</b>{j.patient && <span className="text-xs text-muted">· {j.patient}</span>}
                      {j.flags.map((f) => <span key={f} className={`text-[11px] font-bold px-1.5 py-0.5 rounded ${FLAG[f]?.[1] ?? ""}`}>{FLAG[f]?.[0] ?? f}</span>)}
                    </div>
                    <p className="text-xs text-muted mt-0.5">{STAGES[j.stage] ?? j.stage} aşamasında <b className={j.hours > j.limit ? "text-bad" : ""}>{dur(j.hours)}</b> · {j.holder_name ? `elinde: ${j.holder_name}` : "kimsenin elinde değil"} · teslim {dt(j.due)}</p>
                  </div>
                  <div className="w-full sm:w-auto"><JobFix job={j.id} stage={j.stage} people={b.people} /></div>
                </li>
              ))}
              {!b.jobs.length && <li className="px-4 py-10 text-center text-muted">🎉 Akışta takılan, geciken ya da sahipsiz iş yok.</li>}
            </ul>
          </section>
          <aside className="flex flex-col gap-5">
            <section className="bg-white border border-line rounded-[18px] p-4 flex flex-col gap-2">
              <h2 className="font-display font-semibold text-brand-800">Kimin elinde ne var</h2>
              <ul className="flex flex-col gap-1.5 text-sm">
                {b.workload.map((w) => (
                  <li key={w.employee} className="flex items-center gap-2"><span className="flex-1 truncate">{w.name ?? "—"}</span>{w.stuck > 0 && <span className="text-[11px] font-bold text-bad">{w.stuck} takılı</span>}<b className="num">{w.count}</b></li>
                ))}
                {!b.workload.length && <li className="text-muted">Elinde iş olan yok.</li>}
              </ul>
            </section>
            <section className="bg-white border border-line rounded-[18px] p-4 flex flex-col gap-2">
              <h2 className="font-display font-semibold text-brand-800">Son 7 gün yeniden yapım ({b.remakes.length})</h2>
              <ul className="flex flex-col gap-1 text-sm">
                {b.remakes.slice(0, 10).map((r, i) => <li key={i} className="flex gap-2"><Link href={`/isler/${r.job}`} className="font-mono text-brand-700">#{r.no}</Link><span className="flex-1 truncate">{r.customer}</span><span className="text-xs text-muted">{REASON[r.reason] ?? r.reason}</span></li>)}
                {!b.remakes.length && <li className="text-muted">Yeniden yapım yok 👍</li>}
              </ul>
            </section>
            <p className="text-xs text-muted">Takıldı sınırları: kabul 4 sa, üretim 48 sa, şef ve kalite kontrol 12 sa, sevk 24 sa, provada 10 gün. Atanan kişiye telefon bildirimi gider; her müdahale işin geçmişine ve notlarına yazılır.</p>
          </aside>
        </div>
      </div>
    </>
  );
}
