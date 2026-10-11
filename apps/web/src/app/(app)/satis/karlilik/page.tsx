import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { Notice } from "@/components/erp";
import { PendingSubmit } from "@/components/ConfirmSubmit";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import { saveLabSettings } from "@/lib/pricing-actions";

export const dynamic = "force-dynamic";

type R = { customer_id: string; name: string; currency: string; jobs: number; units: number; revenue_try: number; material_try: number; minutes: number; labor_try: number; overhead_try: number; remakes: number; profit_try: number; margin: number | null };
const tl = (m: number) => `${(Number(m ?? 0) / 100).toLocaleString("tr-TR", { maximumFractionDigits: 0 })} ₺`;

/** Müşteri kârlılığı: ciro − malzeme (lot maliyeti) − işçilik (okutma süreleri) − genel gider; yeniden yapımlar */
export default async function Profitability({ searchParams }: { searchParams: Promise<{ bas?: string; bit?: string; sira?: string }> }) {
  const s = await getSession();
  if ((s.modules.sales ?? 0) < 1 && (s.modules.finance ?? 0) < 1) redirect("/");
  const sp = await searchParams;
  const now = new Date(Date.now() + 3 * 3600 * 1000);
  const from = /^\d{4}-\d{2}-\d{2}$/.test(sp.bas ?? "") ? sp.bas! : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 2, 1)).toISOString().slice(0, 10);
  const to = /^\d{4}-\d{2}-\d{2}$/.test(sp.bit ?? "") ? sp.bit! : now.toISOString().slice(0, 10);
  const supabase = await createClient();
  const [{ data, error }, { data: st }] = await Promise.all([
    supabase.rpc("lab_profitability", { p_from: from, p_to: to }),
    supabase.from("lab_settings").select("labor_cost_hour, overhead_pct").maybeSingle(),
  ]);
  let rows = (data ?? []) as R[];
  if (sp.sira === "marj") rows = [...rows].sort((a, b) => Number(a.margin ?? 0) - Number(b.margin ?? 0));
  const T = rows.reduce((a, r) => ({ rev: a.rev + Number(r.revenue_try), mat: a.mat + Number(r.material_try), lab: a.lab + Number(r.labor_try), oh: a.oh + Number(r.overhead_try), pr: a.pr + Number(r.profit_try), rm: a.rm + r.remakes, jobs: a.jobs + r.jobs }), { rev: 0, mat: 0, lab: 0, oh: 0, pr: 0, rm: 0, jobs: 0 });
  const maxRev = Math.max(1, ...rows.map((r) => Number(r.revenue_try)));
  const canSet = (s.modules.finance ?? 0) >= 3 || (s.modules.sales ?? 0) >= 3;
  const noLabor = !st?.labor_cost_hour;

  return (
    <>
      <PageHeader title="Müşteri kârlılığı" subtitle="Teslim edilen işlerin cirosu (teslim günü kuruyla TL), kullanılan malzemenin maliyeti, okutma sürelerinden işçilik ve genel gider düşülerek." />
      <div className="p-4 md:p-8 flex flex-col gap-5 max-w-[1320px]">
        {error && <Notice tone="bad">Supabase&apos;de 20261216000000_pricing.sql çalıştırılmalı.</Notice>}
        {noLabor && <Notice>İşçilik saat maliyeti girilmemiş; kâr işçiliksiz hesaplanıyor. Aşağıdan girin.</Notice>}
        <form className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-xs font-semibold text-muted">Başlangıç<input type="date" name="bas" defaultValue={from} className="h-10 rounded-[10px] border border-[#D5DEE8] bg-white px-2" /></label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-muted">Bitiş<input type="date" name="bit" defaultValue={to} className="h-10 rounded-[10px] border border-[#D5DEE8] bg-white px-2" /></label>
          <select name="sira" defaultValue={sp.sira ?? ""} className="h-10 rounded-[10px] border border-[#D5DEE8] bg-white px-2 text-sm"><option value="">Ciroya göre</option><option value="marj">En düşük marj önce</option></select>
          <button className="h-10 px-4 rounded-[10px] bg-brand-700 text-white text-sm font-semibold">Göster</button>
        </form>
        <div className="grid gap-3 grid-cols-2 lg:grid-cols-5">
          {[["Ciro", tl(T.rev)], ["Malzeme", tl(T.mat)], ["İşçilik + genel gider", tl(T.lab + T.oh)], ["Kâr", tl(T.pr)], ["Marj", T.rev ? `%${((T.pr / T.rev) * 100).toLocaleString("tr-TR", { maximumFractionDigits: 1 })}` : "—"]].map(([l, v]) => (
            <div key={l} className="rounded-[16px] border border-line bg-white p-4"><div className="text-xs font-semibold text-muted">{l}</div><div className="font-display text-2xl font-bold mt-1">{v}</div></div>
          ))}
        </div>
        <section className="rounded-[16px] border border-line bg-white overflow-x-auto">
          <table className="w-full text-sm min-w-[980px]">
            <thead><tr className="text-left text-xs text-muted"><th className="p-3">Müşteri</th><th className="p-3 text-right">İş / birim</th><th className="p-3 w-56">Ciro</th><th className="p-3 text-right">Malzeme</th><th className="p-3 text-right">İşçilik</th><th className="p-3 text-right">Genel gider</th><th className="p-3 text-right">Kâr</th><th className="p-3 text-right">Marj</th><th className="p-3 text-right">Yeniden yapım</th></tr></thead>
            <tbody>
              {rows.map((r) => {
                const m = Number(r.margin ?? 0);
                return (
                  <tr key={r.customer_id} className="border-t border-[#EEF2F6]">
                    <td className="p-3"><Link href={`/isler/hekimler/${r.customer_id}`} className="font-semibold text-brand-700">{r.name}</Link>{r.currency !== "TRY" && <span className="ml-1 text-[11px] text-muted">{r.currency}</span>}</td>
                    <td className="p-3 text-right">{r.jobs} / {Number(r.units).toLocaleString("tr-TR")}</td>
                    <td className="p-3"><div className="flex items-center gap-2"><span className="h-2 rounded-full bg-[#2563EB]" style={{ width: `${(Number(r.revenue_try) / maxRev) * 100}%`, minWidth: 4 }} /><span className="num whitespace-nowrap">{tl(r.revenue_try)}</span></div></td>
                    <td className="p-3 text-right num">{tl(r.material_try)}</td>
                    <td className="p-3 text-right num">{tl(r.labor_try)}<span className="block text-[10px] text-muted">{Math.round(r.minutes / 60)} sa</span></td>
                    <td className="p-3 text-right num">{tl(r.overhead_try)}</td>
                    <td className={`p-3 text-right num font-semibold ${Number(r.profit_try) < 0 ? "text-bad" : ""}`}>{tl(r.profit_try)}</td>
                    <td className="p-3 text-right"><span className={`rounded-md px-2 py-0.5 text-xs font-bold ${m < 15 ? "bg-bad-bg text-bad" : m < 35 ? "bg-warn-bg text-warn" : "bg-ok-bg text-ok"}`}>%{m.toLocaleString("tr-TR")}</span></td>
                    <td className={`p-3 text-right ${r.remakes ? "text-bad font-semibold" : "text-muted"}`}>{r.remakes || "—"}</td>
                  </tr>
                );
              })}
              {rows.length === 0 && <tr><td colSpan={9} className="p-8 text-center text-muted">Bu dönemde teslim edilen iş yok.</td></tr>}
            </tbody>
          </table>
        </section>
        <p className="text-xs text-muted">Malzeme maliyeti işe kaydedilen malzemelerin ortalama maliyetinden, işçilik kutu okutma ve istasyon sürelerinden gelir. Malzemesi kaydedilmeyen işlerde malzeme maliyeti 0 görünür.</p>
        {canSet && (
          <form action={saveLabSettings} className="rounded-[16px] border border-line bg-white p-4 flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-xs font-semibold text-muted">İşçilik saat maliyeti (TL)<input name="labor" inputMode="decimal" defaultValue={st?.labor_cost_hour ? (Number(st.labor_cost_hour) / 100).toLocaleString("tr-TR") : ""} placeholder="ör. 350" className="h-10 w-40 rounded-[10px] border border-[#D5DEE8] px-2" /></label>
            <label className="flex flex-col gap-1 text-xs font-semibold text-muted">Genel gider (% ciro)<input name="overhead" inputMode="decimal" defaultValue={st?.overhead_pct ? String(st.overhead_pct) : ""} placeholder="ör. 15" className="h-10 w-32 rounded-[10px] border border-[#D5DEE8] px-2" /></label>
            <PendingSubmit className="h-10 px-4 rounded-[10px] border border-[#D5DEE8] text-sm font-semibold">Kaydet</PendingSubmit>
            <span className="text-xs text-muted">Saat maliyeti: aylık toplam personel maliyeti ÷ toplam çalışma saati.</span>
          </form>
        )}
      </div>
    </>
  );
}
