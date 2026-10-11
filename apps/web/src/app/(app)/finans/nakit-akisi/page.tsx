import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { Notice } from "@/components/erp";
import { createClient } from "@/lib/supabase/server";
import { formatDate, getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

type R = { week_start: string; kind: "in" | "out"; label: string; amount: number; ref: string | null };
const tl = (m: number) => `${(Number(m ?? 0) / 100).toLocaleString("tr-TR", { maximumFractionDigits: 0 })} ₺`;

/** 13 haftalık nakit akışı tahmini (TL karşılığı): bugünkü kasa + banka, beklenen girişler ve çıkışlar */
export default async function CashForecast({ searchParams }: { searchParams: Promise<{ hafta?: string }> }) {
  const s = await getSession();
  if ((s.modules.finance ?? 0) < 1) redirect("/");
  const weeks = Math.min(26, Math.max(4, Number((await searchParams).hafta) || 13));
  const supabase = await createClient();
  const [{ data, error }, { data: acc }] = await Promise.all([
    supabase.rpc("fin_cash_forecast", { p_weeks: weeks }),
    supabase.from("fin_account_balances").select("kind, balance_try").in("kind", ["cash", "bank", "pos"]),
  ]);
  const rows = (data ?? []) as R[];
  const start = (acc ?? []).reduce((a, x) => a + Number(x.balance_try), 0);
  const w0 = (() => { const d = new Date(Date.now() + 3 * 3600 * 1000); const dow = (d.getUTCDay() + 6) % 7; d.setUTCDate(d.getUTCDate() - dow); return d.toISOString().slice(0, 10); })();
  const wk = Array.from({ length: weeks }, (_, i) => new Date(new Date(`${w0}T12:00:00Z`).getTime() + i * 7 * 86400000).toISOString().slice(0, 10));
  let bal = start;
  const cols = wk.map((w) => {
    const items = rows.filter((r) => r.week_start === w);
    const inn = items.filter((r) => r.kind === "in").reduce((a, r) => a + Number(r.amount), 0);
    const out = items.filter((r) => r.kind === "out").reduce((a, r) => a + Number(r.amount), 0);
    bal += inn + out;
    return { w, items, inn, out, bal };
  });
  const low = cols.reduce((m, c) => (c.bal < m.bal ? c : m), cols[0] ?? { w: w0, bal: start, inn: 0, out: 0, items: [] });
  const max = Math.max(1, ...cols.map((c) => Math.max(c.inn, -c.out)));
  const balMax = Math.max(1, ...cols.map((c) => Math.abs(c.bal)), Math.abs(start));
  const labels = [...new Set(rows.map((r) => `${r.kind}|${r.label}`))].sort();

  return (
    <>
      <PageHeader title="Nakit akışı tahmini" subtitle="Bugünkü kasa ve banka bakiyesine; müşteri alacakları (vadesine göre), çekler, tedarikçi borçları, kredi taksitleri, tekrarlayan masraflar, satın alma siparişleri ve maaşlar eklenerek." />
      <div className="p-4 md:p-8 flex flex-col gap-5 max-w-[1400px]">
        {error && <Notice tone="bad">Supabase&apos;de 20261218000000_cashflow_kpi.sql çalıştırılmalı.</Notice>}
        <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
          {[["Bugün kasa + banka", tl(start), ""], ["Beklenen giriş", tl(cols.reduce((a, c) => a + c.inn, 0)), "text-ok"], ["Beklenen çıkış", tl(cols.reduce((a, c) => a + c.out, 0)), "text-bad"], [`En düşük bakiye (${low ? formatDate(low.w) : ""} haftası)`, tl(low?.bal ?? start), (low?.bal ?? 0) < 0 ? "text-bad" : ""]].map(([l, v, c]) => (
            <div key={l} className="rounded-[16px] border border-line bg-white p-4"><div className="text-xs font-semibold text-muted">{l}</div><div className={`font-display text-2xl font-bold mt-1 ${c}`}>{v}</div></div>
          ))}
        </div>
        {(low?.bal ?? 0) < 0 && <Notice tone="bad">{formatDate(low!.w)} haftasında bakiye eksiye düşüyor. Tahsilatları öne çekmeyi ya da ödemeleri ertelemeyi değerlendirin.</Notice>}

        <section className="rounded-[18px] border border-line bg-white p-4 overflow-x-auto">
          <svg viewBox={`0 0 ${weeks * 60 + 20} 220`} className="w-full min-w-[720px] h-56" role="img" aria-label="Haftalık giriş, çıkış ve bakiye">
            <line x1="0" x2={weeks * 60 + 20} y1="110" y2="110" stroke="#E1E7EE" />
            {cols.map((c, i) => (
              <g key={c.w}>
                <rect x={10 + i * 60 + 8} y={110 - (c.inn / max) * 95} width="18" height={(c.inn / max) * 95} rx="3" fill="#10B981" />
                <rect x={10 + i * 60 + 28} y="110" width="18" height={(-c.out / max) * 95} rx="3" fill="#F87171" />
                <text x={10 + i * 60 + 27} y="216" textAnchor="middle" fontSize="10" fill="#64748B">{c.w.slice(8, 10)}.{c.w.slice(5, 7)}</text>
              </g>
            ))}
            <polyline fill="none" stroke="#2563EB" strokeWidth="2.5" points={cols.map((c, i) => `${10 + i * 60 + 27},${110 - (c.bal / balMax) * 95}`).join(" ")} />
            {cols.map((c, i) => <circle key={c.w} cx={10 + i * 60 + 27} cy={110 - (c.bal / balMax) * 95} r="3" fill={c.bal < 0 ? "#DC2626" : "#2563EB"} />)}
          </svg>
          <div className="flex gap-4 text-xs text-muted"><span><b className="text-[#10B981]">■</b> giriş</span><span><b className="text-[#F87171]">■</b> çıkış</span><span><b className="text-[#2563EB]">—</b> bakiye</span></div>
        </section>

        <section className="rounded-[18px] border border-line bg-white overflow-x-auto">
          <table className="w-full text-xs min-w-[1100px]">
            <thead>
              <tr className="text-muted"><th className="p-2 text-left sticky left-0 bg-white">Hafta başı</th>{cols.map((c) => <th key={c.w} className="p-2 text-right whitespace-nowrap">{formatDate(c.w).slice(0, 5)}</th>)}</tr>
            </thead>
            <tbody>
              {labels.map((k) => {
                const [kind, label] = k.split("|") as ["in" | "out", string];
                return (
                  <tr key={k} className="border-t border-[#EEF2F6]">
                    <td className={`p-2 sticky left-0 bg-white font-semibold ${kind === "in" ? "text-ok" : "text-bad"}`}>{label}</td>
                    {cols.map((c) => { const x = c.items.find((r) => r.kind === kind && r.label === label); return <td key={c.w} className="p-2 text-right num" title={x?.ref ?? undefined}>{x ? tl(x.amount) : ""}</td>; })}
                  </tr>
                );
              })}
              <tr className="border-t-2 border-line font-semibold"><td className="p-2 sticky left-0 bg-white">Net</td>{cols.map((c) => <td key={c.w} className={`p-2 text-right num ${c.inn + c.out < 0 ? "text-bad" : "text-ok"}`}>{tl(c.inn + c.out)}</td>)}</tr>
              <tr className="font-bold"><td className="p-2 sticky left-0 bg-white">Bakiye</td>{cols.map((c) => <td key={c.w} className={`p-2 text-right num ${c.bal < 0 ? "text-bad" : ""}`}>{tl(c.bal)}</td>)}</tr>
            </tbody>
          </table>
        </section>
        <p className="text-xs text-muted">Müşteri alacakları iş teslim tarihine kart vadesi eklenerek, tedarikçi borçları alış faturası vadesine göre dağıtılır; vadesi geçmiş tutarlar bu haftaya yazılır. Döviz tutarlar güncel kurla TL’ye çevrilir. Maaş tahmini geçen ayın hakedişidir.</p>
      </div>
    </>
  );
}
