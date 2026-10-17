import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { Notice, btnSecondary, selectCls } from "@/components/erp";
import { createClient } from "@/lib/supabase/server";
import { currentPeriod, getSession, periodLabel } from "@/lib/session";
import { attReport, type AttReportRow } from "@/lib/att-report";
import { prevPeriod } from "@/lib/att-control";

export const dynamic = "force-dynamic";
export const metadata = { title: "Puantaj hata raporu" };

const dur = (m: number) => (m ? `${Math.floor(m / 60)} sa ${m % 60} dk` : "—");

/** Personelin aylık puantaj hataları raporu */
export default async function AttReportPage({ searchParams }: { searchParams: Promise<{ ay?: string; bolum?: string }> }) {
  const s = await getSession();
  if (!["owner", "hr", "accountant", "branch_manager"].includes(s.role)) redirect("/");
  const sp = await searchParams;
  const period = /^\d{4}-\d{2}$/.test(sp.ay ?? "") ? sp.ay! : currentPeriod();
  const sb = await createClient();
  let rows: AttReportRow[] = [];
  let prev: AttReportRow[] = [];
  let err: string | null = null;
  try { [rows, prev] = await Promise.all([attReport(sb, period), attReport(sb, prevPeriod(period))]); } catch (e) { err = (e as Error).message; }
  if (sp.bolum) rows = rows.filter((r) => r.dept === sp.bolum);
  const prevMap = new Map(prev.map((r) => [r.employee_id, r.total]));
  const depts = [...new Set(rows.map((r) => r.dept).concat(prev.map((r) => r.dept)))].sort((a, b) => a.localeCompare(b, "tr"));
  const sum = (k: keyof AttReportRow) => rows.reduce((t, r) => t + Number(r[k]), 0);
  const withErr = rows.filter((r) => r.total > 0);

  return (
    <>
      <PageHeader title="Aylık puantaj hata raporu" subtitle={`${periodLabel(period)} · personel bazında kart unutma, eksik okutma, geç gelme, erken çıkma, devamsızlık`}
        actions={<span className="flex gap-4 text-sm font-semibold"><a href={`/puantaj/kontrol/rapor/excel?ay=${period}`} className="text-brand-700">Excel indir</a><Link href={`/puantaj/kontrol?ay=${period}`} className="text-brand-700">← Kontrol merkezi</Link></span>} />
      <div className="p-4 md:p-6 flex flex-col gap-5 max-w-[1400px]">
        {err && <Notice tone="bad">{/att_|schema cache|does not exist/.test(err) ? "Supabase'de mbdental-puantaj-kontrol.sql çalıştırılmalı." : err}</Notice>}
        <form className="flex flex-wrap items-center gap-2">
          <input type="month" name="ay" defaultValue={period} className="h-10 rounded-[10px] border border-[#D5DEE8] px-3" />
          <select name="bolum" defaultValue={sp.bolum ?? ""} className={`${selectCls} w-48 h-10`}><option value="">Tüm bölümler</option>{depts.map((d) => <option key={d} value={d}>{d}</option>)}</select>
          <button className={`${btnSecondary} h-10`}>Göster</button>
        </form>

        <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
          {([["Hatalı personel", withErr.length], ["Kart unutma", sum("forgot")], ["Eksik okutma", sum("missing")], ["Geç gelme", sum("late")], ["Erken çıkma", sum("early")], ["Devamsızlık", sum("absent")]] as [string, number][]).map(([l, v]) => (
            <div key={l} className="rounded-[14px] border border-line bg-white px-4 py-3"><div className="text-xs text-muted">{l}</div><div className="font-display text-2xl font-bold text-brand-800">{v}</div></div>
          ))}
        </div>

        <section className="rounded-[16px] border border-line bg-white overflow-x-auto">
          <table className="w-full text-sm min-w-[1150px]">
            <thead><tr className="text-left text-xs text-muted bg-[#F7F9FB]">
              <th className="p-3">Personel</th><th className="p-3 text-right">Kart unuttu</th><th className="p-3 text-right">Eksik okutma</th><th className="p-3 text-right">Geç gelme</th><th className="p-3 text-right">Erken çıkma</th>
              <th className="p-3 text-right">Devamsız</th><th className="p-3 text-right">11 sa aşımı</th><th className="p-3 text-right">Fazla mesai</th><th className="p-3 text-right">Düzeltilen</th><th className="p-3 text-right">Açık</th><th className="p-3 text-right">Toplam hata</th><th className="p-3 text-right">Önceki ay</th>
            </tr></thead>
            <tbody>
              {rows.map((r) => {
                const p = prevMap.get(r.employee_id);
                return (
                  <tr key={r.employee_id} className="border-t border-[#EEF2F6]">
                    <td className="p-3"><Link href={`/puantaj/kontrol?ay=${period}&durum=all&q=${encodeURIComponent(r.name)}`} className="font-semibold text-brand-700">{r.name}</Link><span className="block text-xs text-muted">{r.dept}</span></td>
                    <td className="p-3 text-right num">{r.forgot || "—"}{r.forgotOver ? <span className="block text-[11px] text-warn">{r.forgotOver} hak aşımı</span> : null}{r.forgotPending ? <span className="block text-[11px] text-muted">{r.forgotPending} onayda</span> : null}</td>
                    <td className="p-3 text-right num">{r.missing || "—"}</td>
                    <td className="p-3 text-right num">{r.late ? <>{r.late}<span className="block text-[11px] text-muted">{dur(r.lateMin)}</span></> : "—"}</td>
                    <td className="p-3 text-right num">{r.early ? <>{r.early}<span className="block text-[11px] text-muted">{dur(r.earlyMin)}</span></> : "—"}</td>
                    <td className={`p-3 text-right num ${r.absent ? "text-bad font-semibold" : ""}`}>{r.absent || "—"}</td>
                    <td className={`p-3 text-right num ${r.longDays ? "text-bad" : ""}`}>{r.longDays || "—"}</td>
                    <td className="p-3 text-right num">{r.overtimeDays ? <>{r.overtimeDays} gün<span className="block text-[11px] text-muted">{dur(r.overtimeMin)}</span></> : "—"}</td>
                    <td className="p-3 text-right num">{r.fixed + r.accepted || "—"}</td>
                    <td className={`p-3 text-right num ${r.open ? "text-bad font-semibold" : ""}`}>{r.open || "—"}</td>
                    <td className="p-3 text-right num font-bold">{r.total}</td>
                    <td className="p-3 text-right num text-muted">{p ?? "—"}{p !== undefined && r.total !== p ? <span className={`ml-1 text-xs ${r.total > p ? "text-bad" : "text-ok"}`}>{r.total > p ? "▲" : "▼"}</span> : null}</td>
                  </tr>
                );
              })}
              {!rows.length && !err && <tr><td colSpan={12} className="p-8 text-center text-muted">Bu ay için kayıt yok. Kontrol merkezini açınca ay hesaplanır.</td></tr>}
            </tbody>
          </table>
        </section>
        <p className="text-xs text-muted">Toplam hata = kart unutma + eksik okutma + geç gelme + erken çıkma + devamsızlık + 11 saat aşımı. Fazla mesai hata sayılmaz. Personel kendi raporunu Puantajım ekranında görür.</p>
      </div>
    </>
  );
}
