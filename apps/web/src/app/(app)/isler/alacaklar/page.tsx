import { Fragment } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { PrintButton } from "@/components/PrintButton";
import { getSession } from "@/lib/session";
import { monthLabel, receivables } from "@/lib/receivables";
import { recvParams, type RecvSp } from "./params";

export const dynamic = "force-dynamic";
export const metadata = { title: "Müşteri alacak raporu" };
const SYM: Record<string, string> = { TRY: "₺", EUR: "€", USD: "$" };
const f0 = (k: number) => (k === 0 ? "" : (k / 100).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const day = (d: string | null) => (d ? d.split("-").reverse().join(".") : "—");

/** Müşteri alacak raporu: ciro, tahsilat, kalan ve kalanın ay ay dağılımı; tek sayfa çıktı + Excel */
export default async function ReceivablesPage({ searchParams }: { searchParams: Promise<RecvSp> }) {
  const s = await getSession();
  if (!s.logistics && (s.modules.finance ?? 0) < 1 && (s.modules.sales ?? 0) < 1) redirect("/");
  const sp = await searchParams;
  const P = recvParams(sp);
  const { rows: all, months } = await receivables(P);
  const q = P.q.toLocaleLowerCase("tr");
  let rows = all.filter((r) => (!q || r.name.toLocaleLowerCase("tr").includes(q)) && (!P.onlyDebt || r.balance > 0 || r.sales > 0 || r.paid > 0));
  if (P.onlyDebt) rows = rows.filter((r) => r.balance > 0);
  rows.sort((a, b) => (P.sort === "ad" ? a.name.localeCompare(b.name, "tr") : P.sort === "ciro" ? b.sales - a.sales : b.balance - a.balance));
  const cols = ["devir", ...months];
    const T = { opening: 0, sales: 0, paid: 0, balance: 0, aging: {} as Record<string, number> };
  for (const r of rows) { T.opening += r.opening; T.sales += r.sales; T.paid += r.paid; T.balance += r.balance; }
  const sym = SYM[P.currency];
  // ay ay bölüm: devir + ciro ya da kalanı olan aylar, her sayfada 4 dönem
  const periods = cols.filter((k) => rows.some((r) => { const m = r.monthly[k]; return !!m && (m.s !== 0 || m.k !== 0); }));
  const groups: string[][] = [];
  for (let i = 0; i < periods.length; i += 4) groups.push(periods.slice(i, i + 4));
  const mt = (k: string) => rows.reduce((a, r) => { const m = r.monthly[k]; if (m) { a.s += m.s; a.p += m.p; a.k += m.k; } return a; }, { s: 0, p: 0, k: 0 });
  const qs = new URLSearchParams(Object.entries({ bas: P.from, bit: P.to, para: P.currency, q: P.q, borclu: P.onlyDebt ? "" : "0", sira: P.sort }).filter(([, v]) => v) as [string, string][]).toString();
  const inp = "h-10 rounded-[10px] border border-[#D5DEE8] px-3 bg-white text-sm";
  const th = "border border-[#CBD5E1] px-1.5 py-1 font-semibold text-left bg-[#F1F5F9]";
  const td = "border border-[#E2E8F0] px-1.5 py-1";
  const tn = `${td} text-right num whitespace-nowrap`;
  const year = P.to.slice(0, 4);

  return (
    <>
      <div className="print:hidden"><PageHeader title="Müşteri alacak raporu" subtitle="Hangi müşteriden ne kadar ciro, ne kadar tahsilat, ne kadar kaldı; kalan alacak hangi aydan" actions={<span className="flex gap-3 items-center text-sm font-semibold"><PrintButton /><a href={`/isler/alacaklar/excel?${qs}`} className="h-10 px-4 inline-flex items-center rounded-[10px] bg-[#16A34A] text-white">Excel indir</a><Link href="/isler/cari" className="text-brand-700">Cari hesaplar</Link></span>} /></div>
      <style>{`@media print { @page { size: A4 landscape; margin: 7mm; } body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } .rep { font-size: 11px !important; } .rep table td, .rep table th { padding: 3px 5px !important; } thead { display: table-header-group; } tr { break-inside: avoid; } aside, nav, header { display: none !important; } }`}</style>
      <div className="p-4 md:p-8 print:p-0 flex flex-col gap-4 max-w-[1500px]">
        <form method="get" className="print:hidden flex flex-wrap items-end gap-2 rounded-[16px] border border-line bg-white p-3">
          <label className="flex flex-col gap-1 text-xs text-muted">Para birimi<select name="para" defaultValue={P.currency} className={inp}><option value="EUR">€ Euro müşteriler</option><option value="TRY">₺ TL müşteriler</option><option value="USD">$ Dolar müşteriler</option></select></label>
          <label className="flex flex-col gap-1 text-xs text-muted">Başlangıç<input type="date" name="bas" defaultValue={P.from} className={inp} /></label>
          <label className="flex flex-col gap-1 text-xs text-muted">Bitiş<input type="date" name="bit" defaultValue={P.to} className={inp} /></label>
          <label className="flex flex-col gap-1 text-xs text-muted">Sıralama<select name="sira" defaultValue={P.sort} className={inp}><option value="bakiye">Kalan alacak</option><option value="ciro">Ciro</option><option value="ad">Ad</option></select></label>
          <label className="flex flex-col gap-1 text-xs text-muted flex-1 min-w-[180px]">Müşteri ara<input name="q" defaultValue={P.q} className={inp} /></label>
          <label className="flex items-center gap-2 text-sm h-10"><input type="checkbox" name="borclu" value="0" defaultChecked={!P.onlyDebt} /> Borcu olmayanlar da</label>
          <button className="h-10 px-5 rounded-[10px] bg-brand-700 text-white font-semibold text-sm">Göster</button>
          <span className="flex gap-3 text-sm font-semibold ml-2">
            <Link href={`?para=${P.currency}&bas=${year}-01-01&bit=${P.to}`} className="text-brand-700">Bu yıl</Link>
            <Link href={`?para=${P.currency}&bas=${P.to.slice(0, 7)}-01&bit=${P.to}`} className="text-brand-700">Bu ay</Link>
          </span>
        </form>

        <section className="grid gap-3 grid-cols-2 lg:grid-cols-4 print:hidden">
          {[["Devir (dönem başı)", T.opening], ["Ciro", T.sales], ["Tahsilat", T.paid], ["Kalan alacak", T.balance]].map(([l, v]) => (
            <div key={String(l)} className="rounded-[14px] border border-line bg-white p-4"><p className="text-xs text-muted font-semibold">{l}</p><p className={`text-xl font-bold num mt-1 ${l === "Kalan alacak" ? "text-bad" : ""}`}>{f0(Number(v)) || "0,00"} {sym}</p></div>
          ))}
        </section>

        <section className="rep bg-white rounded-[16px] border border-line print:border-0 p-3 print:p-0 overflow-x-auto text-[13px]">
          <div className="flex justify-between items-end mb-2">
            <div><p className="font-bold text-[1.35em]">Müşteri alacak raporu · {P.currency === "EUR" ? "Euro" : P.currency === "TRY" ? "TL" : "Dolar"} müşteriler</p><p className="text-muted">{day(P.from)} – {day(P.to)} · {rows.length} müşteri · tutarlar {sym}</p></div>
            <p className="text-right">Kalan alacak: <b className="text-[1.2em]">{f0(T.balance)} {sym}</b><br /><span className="text-muted">Ciro {f0(T.sales)} · Tahsilat {f0(T.paid)}</span></p>
          </div>
          {/* 1. sayfa: özet */}
          <table className="w-full border-collapse">
            <thead>
              <tr><th className={th}>#</th><th className={th}>Müşteri</th><th className={`${th} text-right`}>Devir</th><th className={`${th} text-right`}>Ciro</th><th className={`${th} text-right`}>Tahsilat</th><th className={`${th} text-right`}>Kalan</th><th className={th}>Son tahsilat</th></tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.id} className="break-inside-avoid">
                  <td className={td}>{i + 1}</td>
                  <td className={td}><Link href={`/isler/hekimler/${r.id}`} className="font-semibold text-brand-700 print:text-black">{r.name}</Link></td>
                  <td className={tn}>{f0(r.opening)}</td><td className={tn}>{f0(r.sales)}</td><td className={tn}>{f0(r.paid)}</td>
                  <td className={`${tn} font-bold ${r.balance > 0 ? "text-bad" : "text-ok"}`}>{f0(r.balance) || "0,00"}</td>
                  <td className={`${td} whitespace-nowrap`}>{day(r.lastPay)}</td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td className={`${td} text-center text-muted`} colSpan={7}>Kayıt yok.</td></tr>}
            </tbody>
            <tfoot><tr className="font-bold bg-[#F8FAFC]"><td className={td} colSpan={2}>TOPLAM</td><td className={tn}>{f0(T.opening)}</td><td className={tn}>{f0(T.sales)}</td><td className={tn}>{f0(T.paid)}</td><td className={tn}>{f0(T.balance)}</td><td className={td} /></tr></tfoot>
          </table>

          {/* Ay ay: o ayın cirosu, o aya sayılan tahsilat, o aydan kalan (her sayfada en çok 4 dönem) */}
          {groups.map((g, gi) => (
            <div key={gi} className="mt-6 print:mt-0 print:break-before-page">
              <p className="font-bold text-[1.15em] mb-1">Ay ay ciro, gelen ve kalan · {g.map((k) => (k === "devir" ? "Devir" : monthLabel(k))).join(", ")}</p>
              <table className="w-full border-collapse">
                <thead>
                  <tr><th className={th} rowSpan={2}>#</th><th className={th} rowSpan={2}>Müşteri</th>
                    {g.map((k) => <th key={k} className={`${th} text-center`} colSpan={3}>{k === "devir" ? `Devir (${day(P.from)} öncesi)` : monthLabel(k)}</th>)}
                    <th className={`${th} text-right`} rowSpan={2}>Toplam kalan</th></tr>
                  <tr>{g.map((k) => <Fragment key={k}><th className={`${th} text-right`}>{k === "devir" ? "Bakiye" : "Ciro"}</th><th className={`${th} text-right`}>Gelen</th><th className={`${th} text-right`}>Kalan</th></Fragment>)}</tr>
                </thead>
                <tbody>
                  {rows.filter((r) => g.some((k) => r.monthly[k])).map((r, i) => (
                    <tr key={r.id} className="break-inside-avoid">
                      <td className={td}>{i + 1}</td>
                      <td className={td}>{r.name}</td>
                      {g.map((k) => { const m = r.monthly[k]; return <Fragment key={k}><td className={tn}>{m ? f0(m.s) : ""}</td><td className={`${tn} text-ok`}>{m ? f0(m.p) : ""}</td><td className={`${tn} font-semibold ${m && m.k > 0 ? "text-bad" : ""}`}>{m ? f0(m.k) || "0,00" : ""}</td></Fragment>; })}
                      <td className={`${tn} font-bold`}>{f0(r.balance) || "0,00"}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot><tr className="font-bold bg-[#F8FAFC]"><td className={td} colSpan={2}>TOPLAM</td>
                  {g.map((k) => { const t = mt(k); return <Fragment key={k}><td className={tn}>{f0(t.s)}</td><td className={tn}>{f0(t.p)}</td><td className={tn}>{f0(t.k)}</td></Fragment>; })}
                  <td className={tn}>{f0(T.balance)}</td></tr></tfoot>
              </table>
            </div>
          ))}
          <p className="text-muted mt-2 text-[0.9em]">Ciro: o ay teslim edilen işler. Gelen: tahsilatlar önce en eski borcu kapatır; o ayın cirosuna sayılan tahsilat. Kalan: o aydan hâlâ ödenmemiş tutar (ör. Ocak ciro 100 €, gelen 50 €, kalan 50 €).</p>
        </section>
      </div>
    </>
  );
}
