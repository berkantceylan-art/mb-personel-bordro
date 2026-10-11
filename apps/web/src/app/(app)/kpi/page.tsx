import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { Notice } from "@/components/erp";
import { createClient } from "@/lib/supabase/server";
import { formatDate, getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

type M = { month: string; revenue_try: number; jobs: number; units: number; on_time: number | null; remakes: number; remake_rate: number | null; avg_days: number | null; new_jobs: number; clinics: number };
const MON = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];
const tl = (m: number) => { const v = Number(m ?? 0) / 100; return v >= 1e6 ? `${(v / 1e6).toLocaleString("tr-TR", { maximumFractionDigits: 2 })} mn ₺` : `${v.toLocaleString("tr-TR", { maximumFractionDigits: 0 })} ₺`; };

function Spark({ data, color, fmt, invert }: { data: (number | null)[]; color: string; fmt: (v: number) => string; invert?: boolean }) {
  const vals = data.map((v) => Number(v ?? 0));
  const max = Math.max(1, ...vals);
  const last = vals.at(-1) ?? 0, prev = vals.at(-2) ?? 0;
  const up = last >= prev;
  const good = invert ? !up : up;
  return (
    <div>
      <div className="flex items-end gap-1 h-16">{vals.map((v, i) => <span key={i} className="flex-1 rounded-t" style={{ height: `${Math.max(2, (v / max) * 64)}px`, background: color, opacity: i === vals.length - 1 ? 1 : 0.35 }} />)}</div>
      <div className="flex items-baseline justify-between mt-2"><b className="font-display text-2xl">{fmt(last)}</b>{prev ? <span className={`text-xs font-bold ${good ? "text-ok" : "text-bad"}`}>{up ? "▲" : "▼"} {fmt(Math.abs(last - prev))}</span> : null}</div>
    </div>
  );
}

/** Yönetim KPI: ciro, birim, zamanında teslim, yeniden yapım, üretim süresi, tahsilat günü, hacmi düşen klinikler */
export default async function KpiPage() {
  const s = await getSession();
  if ((s.modules.sales ?? 0) < 1 && (s.modules.finance ?? 0) < 1 && (s.modules.production ?? 0) < 3) redirect("/");
  const supabase = await createClient();
  const [{ data, error }, { data: watch }, { data: recv }] = await Promise.all([
    supabase.rpc("kpi_monthly", { p_months: 12 }),
    supabase.rpc("kpi_clinic_watch"),
    supabase.from("fin_party_balances").select("balance, currency").gt("balance", 0).limit(5000),
  ]);
  const ms = (data ?? []) as M[];
  const label = (m: string) => `${MON[Number(m.slice(5, 7)) - 1]} ${m.slice(2, 4)}`;
  const last3 = ms.slice(-3).reduce((a, m) => a + Number(m.revenue_try), 0);
  const recvTry = (recv ?? []).filter((r) => r.currency === "TRY").reduce((a, r) => a + Number(r.balance), 0);
  const dso = last3 ? Math.round(recvTry / (last3 / 90)) : null;
  const cur = ms.at(-1);

  return (
    <>
      <PageHeader title="Yönetim KPI" subtitle="Son 12 ay: ciro, iş ve birim, zamanında teslim, yeniden yapım oranı, ortalama üretim süresi, tahsilat süresi" actions={<span className="flex gap-4 text-sm font-semibold"><Link href="/satis/karlilik" className="text-brand-700">Kârlılık</Link><Link href="/finans/nakit-akisi" className="text-brand-700">Nakit akışı</Link></span>} />
      <div className="p-4 md:p-8 flex flex-col gap-5 max-w-[1320px]">
        {error && <Notice tone="bad">Supabase&apos;de 20261218000000_cashflow_kpi.sql çalıştırılmalı.</Notice>}
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {[
            ["Ciro (TL karşılığı)", ms.map((m) => m.revenue_try), "#2563EB", tl, false],
            ["Teslim edilen birim", ms.map((m) => Number(m.units)), "#059669", (v: number) => v.toLocaleString("tr-TR"), false],
            ["Zamanında teslim %", ms.map((m) => m.on_time), "#7C3AED", (v: number) => `%${v.toLocaleString("tr-TR")}`, false],
            ["Yeniden yapım %", ms.map((m) => m.remake_rate), "#DC2626", (v: number) => `%${v.toLocaleString("tr-TR")}`, true],
            ["Ortalama üretim süresi (gün)", ms.map((m) => m.avg_days), "#D97706", (v: number) => `${v.toLocaleString("tr-TR")} gün`, true],
            ["Çalışılan klinik", ms.map((m) => m.clinics), "#0891B2", (v: number) => String(v), false],
          ].map(([t, d, c, f, inv]) => (
            <section key={t as string} className="rounded-[18px] border border-line bg-white p-4">
              <h2 className="text-xs font-bold uppercase tracking-wider text-muted mb-2">{t as string}</h2>
              <Spark data={d as (number | null)[]} color={c as string} fmt={f as (v: number) => string} invert={inv as boolean} />
              <div className="mt-1 flex justify-between text-[10px] text-muted"><span>{ms[0] ? label(ms[0].month) : ""}</span><span>{cur ? label(cur.month) : ""}</span></div>
            </section>
          ))}
        </div>
        <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
          <section className="rounded-[18px] border border-line bg-white p-4">
            <h2 className="font-display text-lg font-bold">Tahsilat süresi (DSO)</h2>
            <p className="font-display text-4xl font-black mt-2">{dso !== null ? `${dso} gün` : "—"}</p>
            <p className="text-xs text-muted mt-1">TL alacak bakiyesi ÷ son 3 ayın günlük ortalama cirosu. Düşmesi iyidir.</p>
          </section>
          <section className="rounded-[18px] border border-line bg-white p-4">
            <h2 className="font-display text-lg font-bold">Hacmi düşen klinikler</h2>
            <p className="text-xs text-muted mb-2">Son 60 günde, önceki 60 güne göre iş sayısı %30’dan fazla azalanlar</p>
            <ul className="divide-y divide-[#EEF2F6] text-sm">
              {((watch ?? []) as { customer_id: string; name: string; last_job: string; prev60: number; last60: number; change_pct: number | null }[]).map((w) => (
                <li key={w.customer_id} className="py-2 flex items-center justify-between gap-2"><Link href={`/isler/hekimler/${w.customer_id}`} className="font-semibold text-brand-700">{w.name}</Link><span className="text-xs text-muted">{w.prev60} → {w.last60} iş · son iş {formatDate(w.last_job)}</span><b className="text-bad">%{w.change_pct ?? -100}</b></li>
              ))}
              {(watch ?? []).length === 0 && <li className="py-3 text-muted">Hacmi belirgin düşen klinik yok.</li>}
            </ul>
          </section>
        </div>
        <section className="rounded-[18px] border border-line bg-white overflow-x-auto">
          <table className="w-full text-sm min-w-[900px]">
            <thead><tr className="text-left text-xs text-muted"><th className="p-3">Ay</th><th className="p-3 text-right">Ciro</th><th className="p-3 text-right">Teslim / yeni iş</th><th className="p-3 text-right">Birim</th><th className="p-3 text-right">Zamanında</th><th className="p-3 text-right">Yeniden yapım</th><th className="p-3 text-right">Ort. süre</th><th className="p-3 text-right">Klinik</th></tr></thead>
            <tbody>{[...ms].reverse().map((m) => <tr key={m.month} className="border-t border-[#EEF2F6]"><td className="p-3 font-semibold">{label(m.month)}</td><td className="p-3 text-right num">{tl(m.revenue_try)}</td><td className="p-3 text-right">{m.jobs} / {m.new_jobs}</td><td className="p-3 text-right">{Number(m.units).toLocaleString("tr-TR")}</td><td className="p-3 text-right">{m.on_time != null ? `%${m.on_time}` : "—"}</td><td className="p-3 text-right">{m.remakes}{m.remake_rate != null ? ` (%${m.remake_rate})` : ""}</td><td className="p-3 text-right">{m.avg_days != null ? `${m.avg_days} g` : "—"}</td><td className="p-3 text-right">{m.clinics}</td></tr>)}</tbody>
          </table>
        </section>
      </div>
    </>
  );
}
