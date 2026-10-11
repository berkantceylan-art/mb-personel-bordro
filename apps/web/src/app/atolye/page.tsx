import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import { FLOW_ACTION, FLOW_ROLE, FLOW_STAGE, since } from "@/lib/flow";
import { AutoRefresh } from "../(app)/uretim/_parts/AutoRefresh";
import { Clock } from "./Clock";

export const dynamic = "force-dynamic";
export const metadata = { title: "Atölye ekranı" };

type Board = {
  now: string;
  today: { in_jobs: number; in_units: number; out_jobs: number; out_units: number; open_jobs: number; open_units: number; late_jobs: number; late_units: number; due_today: number; due_today_units: number; due_tomorrow: number; tryin: number; unassigned: number };
  month: { currency: string; jobs: number; units: number; total: number }[];
  stages: { stage: string; jobs: number; units: number; held: number; late: number }[];
  people: { id: string; name: string; role: string; holding: number; holding_units: number; done_today: number; units_today: number; oldest: string | null }[];
  clinics: { id: string; name: string; jobs: number; units: number; late: number; next_due: string | null; out_today: number }[];
  trend: { d: string; in: number; out: number }[];
  feed: { at: string; action: string; stage: string; no: number; who: string | null; customer: string | null }[];
  forecast: { avg_out_units: number; days_left: number | null };
};
const n = (v: number) => Number(v ?? 0).toLocaleString("tr-TR", { maximumFractionDigits: 1 });
const SYM: Record<string, string> = { TRY: "₺", EUR: "€", USD: "$" };

/** Atölye ekranı: şirketteki bilgisayar / TV için tam ekran, 30 sn'de bir tazelenen canlı üretim panosu */
export default async function WorkshopScreen() {
  const s = await getSession();
  if ((s.modules.production ?? 0) < 1 && !s.logistics) redirect("/");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("prd_workshop_board");
  const b = data as Board | null;
  const today = new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10);
  const maxTrend = Math.max(1, ...(b?.trend ?? []).flatMap((t) => [Number(t.in), Number(t.out)]));
  const maxStage = Math.max(1, ...(b?.stages ?? []).map((x) => Number(x.units)));
  const maxPerson = Math.max(1, ...(b?.people ?? []).map((p) => Number(p.holding_units) + Number(p.units_today)));

  return (
    <main className="min-h-screen bg-[#07111F] text-white p-4 lg:p-6 flex flex-col gap-4 overflow-hidden" style={{ backgroundImage: "radial-gradient(circle at 15% 0%, rgba(37,99,235,.18), transparent 45%), radial-gradient(circle at 90% 100%, rgba(5,150,105,.14), transparent 40%)" }}>
      <AutoRefresh seconds={30} />
      <header className="flex items-center gap-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.svg" alt="" className="w-11 h-11 object-contain rounded-xl bg-white p-1" />
        <div className="flex-1">
          <h1 className="font-display text-2xl lg:text-3xl font-bold leading-none">Atölye · canlı üretim</h1>
          <span className="text-sm text-white/50 flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-[#22C55E] animate-pulse" />30 saniyede bir yenilenir · {s.companyName}</span>
        </div>
        <Link href="/uretim/nerede" className="hidden md:inline text-sm text-white/50 hover:text-white">İş nerede →</Link>
        <Clock />
      </header>

      {error || !b ? (
        <p className="rounded-2xl bg-white/10 p-6 text-lg">Atölye verisi alınamadı: Supabase&apos;de 20261213000000_workshop.sql çalıştırılmalı.</p>
      ) : (
        <>
          <section className="grid gap-3 grid-cols-2 md:grid-cols-3 xl:grid-cols-6">
            {[
              ["Bugün giren", b.today.in_jobs, `${n(b.today.in_units)} birim`, "#60A5FA"],
              ["Bugün çıkan", b.today.out_jobs, `${n(b.today.out_units)} birim`, "#34D399"],
              ["Kalan iş", b.today.open_jobs, `${n(b.today.open_units)} birim`, "#FFFFFF"],
              ["Geciken", b.today.late_jobs, `${n(b.today.late_units)} birim`, b.today.late_jobs ? "#F87171" : "#94A3B8"],
              ["Bugün teslim", b.today.due_today, `yarın ${b.today.due_tomorrow} · provada ${b.today.tryin}`, "#FBBF24"],
              ["Tahmini bitiş", b.forecast.days_left ?? "—", `günde ~${n(b.forecast.avg_out_units)} birim çıkıyor`, "#A78BFA"],
            ].map(([l, v, sub, c]) => (
              <div key={String(l)} className="rounded-2xl bg-white/[.06] border border-white/10 p-4 backdrop-blur">
                <div className="text-xs uppercase tracking-wider text-white/50">{l}</div>
                <div className="font-display text-5xl xl:text-6xl font-black leading-tight tabular-nums" style={{ color: String(c) }}>{typeof v === "number" ? n(v) : v}{l === "Tahmini bitiş" && b.forecast.days_left != null ? <span className="text-xl font-bold text-white/60"> gün</span> : null}</div>
                <div className="text-sm text-white/60">{sub}</div>
              </div>
            ))}
          </section>

          <section className="rounded-2xl bg-white/[.04] border border-white/10 p-4">
            <div className="flex items-baseline gap-3 mb-3"><h2 className="font-display text-lg font-bold">Akış</h2><span className="text-sm text-white/50">işler hangi aşamada</span>{b.today.unassigned > 0 && <span className="ml-auto text-sm text-[#FBBF24]">{b.today.unassigned} iş sırada, kimse almadı</span>}</div>
            <div className="grid gap-2 grid-cols-3 lg:grid-cols-6">
              {b.stages.map((st) => (
                <div key={st.stage} className="relative rounded-xl overflow-hidden bg-white/[.05] p-3">
                  <div className="absolute inset-x-0 bottom-0 opacity-30" style={{ height: `${(Number(st.units) / maxStage) * 100}%`, background: FLOW_STAGE[st.stage]?.[1] }} />
                  <div className="relative">
                    <div className="flex items-center gap-2 text-sm font-semibold"><span className="w-2.5 h-2.5 rounded-full" style={{ background: FLOW_STAGE[st.stage]?.[1] }} />{FLOW_STAGE[st.stage]?.[0]}</div>
                    <div className="font-display text-4xl font-black tabular-nums">{st.jobs}</div>
                    <div className="text-xs text-white/60">{n(st.units)} birim · {st.held} elde{st.late ? <span className="text-[#F87171]"> · {st.late} geç</span> : null}</div>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <div className="grid gap-4 xl:grid-cols-[1.3fr_1fr_.9fr] flex-1 min-h-0">
            <section className="rounded-2xl bg-white/[.04] border border-white/10 p-4 min-h-0 overflow-hidden">
              <div className="flex items-baseline gap-3 mb-3"><h2 className="font-display text-lg font-bold">Ekip</h2><span className="text-sm text-white/50">elindeki · bugün bitirdiği</span></div>
              <div className="grid gap-2 sm:grid-cols-2">
                {b.people.slice(0, 16).map((p) => (
                  <div key={p.id} className="rounded-xl bg-white/[.05] p-3">
                    <div className="flex items-baseline gap-2"><b className="truncate">{p.name}</b><span className="text-[11px] text-white/40">{FLOW_ROLE[p.role] ?? p.role}</span></div>
                    <div className="mt-1 flex h-2.5 rounded-full overflow-hidden bg-white/10">
                      <span style={{ width: `${(Number(p.holding_units) / maxPerson) * 100}%` }} className="bg-[#60A5FA]" />
                      <span style={{ width: `${(Number(p.units_today) / maxPerson) * 100}%` }} className="bg-[#34D399]" />
                    </div>
                    <div className="mt-1 flex justify-between text-xs text-white/60"><span><b className="text-[#93C5FD]">{p.holding}</b> iş elinde ({n(p.holding_units)} br){p.oldest ? ` · ${since(p.oldest)}` : ""}</span><span><b className="text-[#6EE7B7]">{p.done_today}</b> bitti · {n(p.units_today)} br</span></div>
                  </div>
                ))}
                {b.people.length === 0 && <p className="text-white/50">Akış ekibi tanımlı değil (Üretim › Akış ekibi).</p>}
              </div>
            </section>

            <section className="rounded-2xl bg-white/[.04] border border-white/10 p-4 min-h-0 overflow-hidden flex flex-col">
              <div className="flex items-baseline gap-3 mb-3"><h2 className="font-display text-lg font-bold">Klinik ve hekimler</h2><span className="text-sm text-white/50">açık işler</span></div>
              <table className="w-full text-sm">
                <thead><tr className="text-left text-xs text-white/40"><th className="pb-1">Klinik / hekim</th><th className="pb-1 text-right">İş</th><th className="pb-1 text-right">Birim</th><th className="pb-1 text-right">Geç</th><th className="pb-1 text-right">En yakın</th></tr></thead>
                <tbody>
                  {b.clinics.slice(0, 14).map((c) => (
                    <tr key={c.id} className="border-t border-white/5">
                      <td className="py-1.5 truncate max-w-[180px]">{c.name}{c.out_today ? <span className="ml-1 text-[11px] text-[#6EE7B7]">+{c.out_today} çıktı</span> : null}</td>
                      <td className="py-1.5 text-right font-bold tabular-nums">{c.jobs}</td>
                      <td className="py-1.5 text-right tabular-nums text-white/70">{n(c.units)}</td>
                      <td className={`py-1.5 text-right tabular-nums ${c.late ? "text-[#F87171] font-bold" : "text-white/30"}`}>{c.late || "—"}</td>
                      <td className={`py-1.5 text-right text-xs ${c.next_due && c.next_due < today ? "text-[#F87171]" : c.next_due === today ? "text-[#FBBF24]" : "text-white/60"}`}>{c.next_due ? new Date(`${c.next_due}T12:00:00Z`).toLocaleDateString("tr-TR", { day: "2-digit", month: "2-digit" }) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="mt-auto pt-3">
                <div className="text-xs text-white/40 mb-1">Son 14 gün · <span className="text-[#60A5FA]">giren</span> / <span className="text-[#34D399]">çıkan</span> birim</div>
                <div className="flex items-end gap-1 h-20">
                  {b.trend.map((t) => (
                    <div key={t.d} className="flex-1 flex items-end gap-px" title={`${t.d}: ${t.in} giren / ${t.out} çıkan`}>
                      <span className="flex-1 rounded-t bg-[#60A5FA]/70" style={{ height: `${(Number(t.in) / maxTrend) * 80}px` }} />
                      <span className="flex-1 rounded-t bg-[#34D399]" style={{ height: `${(Number(t.out) / maxTrend) * 80}px` }} />
                    </div>
                  ))}
                </div>
              </div>
            </section>

            <section className="rounded-2xl bg-white/[.04] border border-white/10 p-4 min-h-0 overflow-hidden">
              <div className="flex items-baseline gap-3 mb-3"><h2 className="font-display text-lg font-bold">Son okutmalar</h2></div>
              <ul className="flex flex-col gap-1.5 text-sm">
                {b.feed.slice(0, 14).map((f, i) => (
                  <li key={i} className="flex items-baseline gap-2">
                    <span className="text-xs tabular-nums text-white/40 w-11">{new Date(f.at).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Istanbul" })}</span>
                    <span className="w-2 h-2 rounded-full shrink-0 self-center" style={{ background: FLOW_STAGE[f.stage]?.[1] ?? "#64748B" }} />
                    <span className="min-w-0 truncate"><b>#{f.no}</b> {f.who ?? "Sistem"} <span className="text-white/60">{FLOW_ACTION[f.action] ?? f.action}</span></span>
                  </li>
                ))}
              </ul>
              {b.month.length > 0 && (
                <div className="mt-4 rounded-xl bg-white/[.05] p-3">
                  <div className="text-xs uppercase tracking-wider text-white/40">Bu ay çıkan</div>
                  {b.month.map((m) => <div key={m.currency} className="flex justify-between gap-2"><span className="font-display text-2xl font-bold tabular-nums">{n(m.jobs)} iş</span><span className="text-white/60 self-end">{n(m.units)} br · {(Number(m.total) / 100).toLocaleString("tr-TR", { maximumFractionDigits: 0 })} {SYM[m.currency] ?? m.currency}</span></div>)}
                </div>
              )}
            </section>
          </div>
        </>
      )}
    </main>
  );
}
