import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { currentPeriod, getSession, periodLabel } from "@/lib/session";
import { groupBy, loadPieceEntries, pcErr, prevMonth, STATUS } from "@/lib/piecework";

export const dynamic = "force-dynamic";
export const metadata = { title: "Parça başı raporu" };

const tl = (k: number) => (k / 100).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " ₺";
const n = (v: number) => v.toLocaleString("tr-TR", { maximumFractionDigits: 2 });
const P = /^\d{4}-\d{2}$/;

function Table({ title, head, rows, total }: { title: string; head: string[]; rows: React.ReactNode[][]; total?: React.ReactNode[] }) {
  return (
    <section className="bg-white border border-line rounded-[16px] overflow-x-auto">
      <h2 className="font-display font-semibold text-brand-800 px-5 pt-4 pb-2">{title}</h2>
      <table className="w-full text-[13px]">
        <thead><tr className="text-left text-xs text-muted">{head.map((h, i) => <th key={h} className={`py-2 px-3 first:pl-5 last:pr-5 font-semibold border-b border-line ${i ? "text-right" : ""}`}>{h}</th>)}</tr></thead>
        <tbody>
          {rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className={`py-2 px-3 first:pl-5 last:pr-5 border-b border-[#EEF2F6] ${j ? "num text-right" : ""}`}>{c}</td>)}</tr>)}
          {!rows.length && <tr><td colSpan={head.length} className="px-5 py-6 text-muted">Kayıt yok.</td></tr>}
        </tbody>
        {total && rows.length > 0 && <tfoot><tr className="font-semibold">{total.map((c, j) => <td key={j} className={`py-2.5 px-3 first:pl-5 last:pr-5 ${j ? "num text-right" : "text-muted"}`}>{c}</td>)}</tr></tfoot>}
      </table>
    </section>
  );
}

/** Parça başı raporu: usta, ürün, ay, iş bazında; personel / dış usta gider ayrımı */
export default async function PieceReportPage({ searchParams }: { searchParams: Promise<{ bas?: string; bit?: string; durum?: string }> }) {
  const sp = await searchParams;
  const s = await getSession();
  const mgr = ["owner", "hr", "accountant", "branch_manager"].includes(s.role);
  if (!mgr && (s.modules.production ?? 0) < 1 && (s.modules.payroll ?? 0) < 1 && (s.modules.finance ?? 0) < 1) redirect("/");
  const to = P.test(sp.bit ?? "") ? sp.bit! : currentPeriod();
  const from = P.test(sp.bas ?? "") ? sp.bas! : prevMonth(prevMonth(to));
  const durum = sp.durum === "aktarilan" ? "posted" : "";
  const { rows: all, error } = await loadPieceEntries(await createClient(), from <= to ? from : to, from <= to ? to : from, durum ? { status: durum } : {});
  const rows = all.filter((r) => r.status !== "rejected");
  const total = rows.reduce((t, r) => t + r.amount, 0);
  const qty = rows.reduce((t, r) => t + r.qty, 0);
  const internal = rows.filter((r) => r.kind === "internal").reduce((t, r) => t + r.amount, 0);
  const external = total - internal;
  const stopaj = rows.reduce((t, r) => t + Number(r.stopaj_amount ?? 0), 0);
  const byStatus = groupBy(rows, (r) => r.status, (r) => r.qty, (r) => r.amount);
  const byWorker = groupBy(rows, (r) => `${r.worker}|${r.kind}`, (r) => r.qty, (r) => r.amount);
  const byProduct = groupBy(rows, (r) => r.product ?? r.work_name, (r) => r.qty, (r) => r.amount);
  const byJob = groupBy(rows.filter((r) => r.job_no), (r) => r.job_no!, (r) => r.qty, (r) => r.amount).slice(0, 30);
  const months = [...new Set(rows.map((r) => r.period))].sort();
  const monthly = months.map((m) => {
    const mr = rows.filter((r) => r.period === m);
    const i = mr.filter((r) => r.kind === "internal").reduce((t, r) => t + r.amount, 0);
    const e = mr.filter((r) => r.kind === "external").reduce((t, r) => t + r.amount, 0);
    return { m, i, e, q: mr.reduce((t, r) => t + r.qty, 0) };
  });
  const maxM = Math.max(1, ...monthly.map((x) => x.i + x.e));
  const qs = new URLSearchParams({ bas: from, bit: to, ...(sp.durum ? { durum: sp.durum } : {}) }).toString();
  const err = pcErr(error);

  return (
    <>
      <PageHeader title="Parça başı raporu" subtitle={`${periodLabel(from)} – ${periodLabel(to)} · reddedilenler hariç`}
        actions={<span className="flex gap-4 text-sm font-semibold"><a href={`/uretim/parca-basi/rapor/excel?${qs}`} className="text-brand-700">⬇ Excel</a><Link href="/uretim/parca-basi" className="text-brand-700">← Parça başı</Link></span>} />
      <div className="p-4 md:p-6 flex flex-col gap-5 max-w-[1400px]">
        {err && <p className="text-sm text-bad bg-bad-bg rounded-lg p-3">{err}</p>}
        <form className="flex flex-wrap gap-2 items-end">
          <label className="flex flex-col gap-1 text-xs text-muted">Başlangıç<input type="month" name="bas" defaultValue={from} className="h-10 rounded-[10px] border border-[#D5DEE8] bg-white px-3 text-sm" /></label>
          <label className="flex flex-col gap-1 text-xs text-muted">Bitiş<input type="month" name="bit" defaultValue={to} className="h-10 rounded-[10px] border border-[#D5DEE8] bg-white px-3 text-sm" /></label>
          <label className="flex flex-col gap-1 text-xs text-muted">Kayıtlar
            <select name="durum" defaultValue={sp.durum ?? ""} className="h-10 rounded-[10px] border border-[#D5DEE8] bg-white px-3 text-sm"><option value="">Hepsi (bekleyen + onaylı + aktarılan)</option><option value="aktarilan">Yalnız aktarılan (kesinleşen gider)</option></select>
          </label>
          <button className="h-10 px-4 rounded-[10px] bg-brand-700 text-white font-semibold text-sm">Göster</button>
        </form>

        <section className="grid gap-3 grid-cols-2 lg:grid-cols-5">
          <div className="col-span-2 lg:col-span-1 rounded-[16px] p-4 bg-gradient-to-br from-[#0A3D73] to-[#1565A8] text-white"><span className="text-xs opacity-80">Toplam parça başı gider</span><b className="num block font-display text-2xl">{tl(total)}</b><span className="text-xs opacity-80">{n(qty)} adet · {rows.length} kayıt</span></div>
          <div className="rounded-[16px] p-4 bg-white border border-line"><span className="text-xs text-muted">Personel (maaşa ek)</span><b className="num block font-display text-xl text-brand-800">{tl(internal)}</b><span className="text-xs text-muted">%{total ? Math.round((internal / total) * 100) : 0}</span></div>
          <div className="rounded-[16px] p-4 bg-white border border-line"><span className="text-xs text-muted">Dış usta (gider)</span><b className="num block font-display text-xl text-[#5B3A9A]">{tl(external)}</b><span className="text-xs text-muted">%{total ? Math.round((external / total) * 100) : 0}</span></div>
          <div className="rounded-[16px] p-4 bg-white border border-line"><span className="text-xs text-muted">Ortalama birim</span><b className="num block font-display text-xl text-brand-800">{tl(qty ? Math.round(total / qty) : 0)}</b><span className="text-xs text-muted">adet / üye başına</span></div>
          <div className="rounded-[16px] p-4 bg-white border border-line"><span className="text-xs text-muted">Kesilen stopaj</span><b className="num block font-display text-xl text-brand-800">{tl(stopaj)}</b><span className="text-xs text-muted">vergi dairesine</span></div>
        </section>

        <section className="bg-white border border-line rounded-[16px] p-5 flex flex-col gap-3">
          <div className="flex justify-between items-baseline"><h2 className="font-display font-semibold text-brand-800">Aylık gider · personel / dış usta</h2>
            <span className="text-[11px] text-muted flex gap-3"><span><span className="inline-block w-2.5 h-2.5 rounded-sm bg-[#1565A8] mr-1" />Personel</span><span><span className="inline-block w-2.5 h-2.5 rounded-sm bg-[#7C5CC4] mr-1" />Dış usta</span></span></div>
          <div className="flex flex-col gap-2">
            {monthly.map((x) => (
              <div key={x.m} className="grid grid-cols-[90px_1fr_120px] items-center gap-3 text-[13px]" title={`Personel ${tl(x.i)} · Dış usta ${tl(x.e)}`}>
                <span className="text-muted">{periodLabel(x.m)}</span>
                <div className="flex h-5 gap-[2px]">
                  {x.i > 0 && <div className="h-full rounded-l-[4px] bg-[#1565A8]" style={{ width: `${(x.i / maxM) * 100}%` }} />}
                  {x.e > 0 && <div className={`h-full bg-[#7C5CC4] rounded-r-[4px] ${x.i ? "" : "rounded-l-[4px]"}`} style={{ width: `${(x.e / maxM) * 100}%` }} />}
                </div>
                <b className="num text-right text-ink">{tl(x.i + x.e)}</b>
              </div>
            ))}
            {!monthly.length && <p className="text-sm text-muted">Kayıt yok.</p>}
          </div>
        </section>

        <div className="grid gap-5 lg:grid-cols-2">
          <Table title="Usta bazında" head={["Usta", "Adet", "Kayıt", "Tutar"]}
            rows={byWorker.map(([k, g]) => { const [name, kind] = k.split("|"); return [<span key="n"><b>{name}</b> <span className="text-[10px] font-bold text-muted">{kind === "internal" ? "PERSONEL" : "DIŞ"}</span></span>, n(g.qty), g.n, tl(g.amount)]; })}
            total={["Toplam", n(qty), rows.length, tl(total)]} />
          <Table title="Ürün / iş bazında (birim maliyet etkisi)" head={["Ürün / iş", "Adet", "Ort. birim", "Tutar"]}
            rows={byProduct.map(([k, g]) => [k, n(g.qty), tl(g.qty ? Math.round(g.amount / g.qty) : 0), tl(g.amount)])}
            total={["Toplam", n(qty), tl(qty ? Math.round(total / qty) : 0), tl(total)]} />
          <Table title="Durum" head={["Durum", "Adet", "Kayıt", "Tutar"]}
            rows={byStatus.map(([k, g]) => [STATUS[k as keyof typeof STATUS]?.label ?? k, n(g.qty), g.n, tl(g.amount)])} />
          <Table title="İş bazında (en yüksek 30)" head={["İş no", "Adet", "Kayıt", "Tutar"]}
            rows={byJob.map(([k, g]) => [<a key="j" href={`/isler?q=${k}`} className="font-semibold text-brand-700">{k}</a>, n(g.qty), g.n, tl(g.amount)])} />
        </div>
        <p className="text-xs text-muted">Gider görünümü: dış usta aktarımları finansta <b>“Parça başı işçilik”</b> gider kalemine, personel aktarımları maaş carisine ek ödeme olarak yazılır. Ürün maliyetindeki pay son 90 günün verisiyle hesaplanır.</p>
      </div>
    </>
  );
}
