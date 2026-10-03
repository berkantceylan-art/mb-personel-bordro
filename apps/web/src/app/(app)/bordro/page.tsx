import Link from "next/link";
import { redirect } from "next/navigation";
import { formatTL, nextPeriod, previousPeriod } from "@mb/core";
import { PageHeader, Stat } from "@/components/ui";
import { computePayroll } from "@/lib/payroll";
import { createClient } from "@/lib/supabase/server";
import { canManagePay, currentPeriod, getSession, periodLabel } from "@/lib/session";
import { PayrollButtons } from "./PayrollButtons";
import { unpostDeductions } from "./actions";

export default async function PayrollPage({ searchParams }: { searchParams: Promise<{ donem?: string; bolum?: string; gorunum?: string }> }) {
  const s = await getSession();
  if (!canManagePay(s.role)) redirect("/");
  const sp = await searchParams;
  const period = sp.donem && /^\d{4}-\d{2}$/.test(sp.donem) ? sp.donem : currentPeriod();
  const view = sp.gorunum === "ic" ? "ic" : "resmi";
  const supabase = await createClient();
  const all = await computePayroll(supabase, period);
  const rows = all.filter((r) => !sp.bolum || r.dept === sp.bolum);
  const depts = [...new Set(all.map((r) => r.dept))];
  const savedCount = all.filter((r) => r.saved).length;
  const postedCount = all.filter((r) => r.saved?.posted).length;
  const t = rows.reduce(
    (a, r) => {
      const b = r.result.breakdown;
      a.gross += b.gross; a.sgk += b.sgkEmployee + b.unemploymentEmployee; a.gv += b.incomeTax; a.dv += b.stampTax; a.net += b.net;
      a.bes += b.bes; a.icra += r.result.garnishmentTotal; a.bank += r.result.netToBank; a.cost += b.employerCost;
      a.accrued += r.ledger.accrued; a.paidBank += r.ledger.paidBank; a.paidCash += r.ledger.paidCash; a.payBank += r.pay.bank; a.payCash += r.pay.cash;
      return a;
    },
    { gross: 0, sgk: 0, gv: 0, dv: 0, net: 0, bes: 0, icra: 0, bank: 0, cost: 0, accrued: 0, paidBank: 0, paidCash: 0, payBank: 0, payCash: 0 },
  );
  const q = (o: Record<string, string>) => "/bordro?" + new URLSearchParams({ donem: period, gorunum: view, ...(sp.bolum ? { bolum: sp.bolum } : {}), ...o }).toString();
  const th = "py-2.5 px-2 font-semibold border-b border-line text-right whitespace-nowrap";
  const td = "num py-2 px-2 border-b border-[#EEF2F6] text-right whitespace-nowrap";

  return (
    <>
      <PageHeader
        title="Bordro"
        subtitle={`${periodLabel(period)} · ${savedCount}/${all.length} kaydedildi · ${postedCount} kesinti cariye yazıldı`}
        actions={
          <div className="flex gap-2 flex-wrap">
            <Link href={q({ donem: previousPeriod(period) })} className="h-11 px-3 inline-flex items-center rounded-[10px] border border-[#D5DEE8] bg-white font-semibold text-brand-700">←</Link>
            <Link href={q({ donem: nextPeriod(period) })} className="h-11 px-3 inline-flex items-center rounded-[10px] border border-[#D5DEE8] bg-white font-semibold text-brand-700">→</Link>
            <a href={`/yazdir/bordro/${period}?tur=resmi${sp.bolum ? `&bolum=${encodeURIComponent(sp.bolum)}` : ""}`} target="_blank" className="h-11 px-4 inline-flex items-center rounded-[10px] border border-[#D5DEE8] bg-white font-semibold text-brand-700">Resmi bordrolar (PDF)</a>
            <a href={`/yazdir/bordro/${period}?tur=ic${sp.bolum ? `&bolum=${encodeURIComponent(sp.bolum)}` : ""}`} target="_blank" className="h-11 px-4 inline-flex items-center rounded-[10px] border border-[#D5DEE8] bg-white font-semibold text-brand-700">İç hakediş fişleri (PDF)</a>
          </div>
        }
      />
      <div className="p-4 md:p-6 flex flex-col gap-4">
        <div className="flex flex-wrap gap-4 items-start justify-between">
          <PayrollButtons period={period} canPost={savedCount > postedCount} />
          {postedCount > 0 && (
            <form action={unpostDeductions}>
              <input type="hidden" name="period" value={period} />
              <button className="h-11 px-4 rounded-[10px] border border-[#D5DEE8] bg-white text-sm font-semibold text-muted">Kesintileri geri al</button>
            </form>
          )}
        </div>

        <section className="grid gap-4 grid-cols-[repeat(auto-fit,minmax(200px,1fr))]">
          <Stat label="Resmi brüt toplam" value={formatTL(t.gross)} sub={`İşveren maliyeti ${formatTL(t.cost)}`} />
          <Stat label="Bankaya yatacak (bordro neti)" value={formatTL(t.bank)} sub={`BES ${formatTL(t.bes)} · icra ${formatTL(t.icra)}`} />
          <Stat label="Kalan: bankadan ödenecek" value={formatTL(t.payBank)} sub={`Önceden bankadan ${formatTL(t.paidBank)}`} />
          <Stat label="Kalan: elden verilecek" value={formatTL(t.payCash)} sub={`Önceden elden ${formatTL(t.paidCash)}`} />
        </section>

        <div className="flex flex-wrap gap-3 items-center">
          <div className="flex gap-1 border-b border-line" role="tablist">
            {[["resmi", "Resmi bordro"], ["ic", "İç hakediş / ödeme"]].map(([k, l]) => (
              <Link key={k} href={q({ gorunum: k })} role="tab" aria-selected={view === k} className={`h-11 px-4 inline-flex items-center ${view === k ? "font-bold text-brand-700 shadow-[inset_0_-3px_0_#00A6D6]" : "text-muted"}`}>{l}</Link>
            ))}
          </div>
          <form className="flex gap-2 ml-auto">
            <input type="hidden" name="donem" value={period} />
            <input type="hidden" name="gorunum" value={view} />
            <select name="bolum" defaultValue={sp.bolum ?? ""} aria-label="Bölüm" className="h-11 rounded-[10px] border border-[#D5DEE8] bg-white px-3">
              <option value="">Tüm bölümler</option>
              {depts.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
            <button className="h-11 px-4 rounded-[10px] bg-brand-700 text-white font-semibold">Filtrele</button>
          </form>
        </div>

        <section className="bg-white border border-line rounded-[14px] overflow-x-auto">
          {view === "resmi" ? (
            <table className="w-full text-[13px] min-w-[1100px]">
              <thead>
                <tr className="text-xs text-muted">
                  <th className={`${th} text-left`}>Personel</th><th className={th}>Gün</th><th className={th}>Brüt</th><th className={th}>SGK+İşsiz.</th>
                  <th className={th}>Gelir v.</th><th className={th}>Damga v.</th><th className={th}>Net</th><th className={th}>BES</th><th className={th}>İcra</th><th className={th}>Bankaya</th><th className={th}>Durum</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const b = r.result.breakdown;
                  return (
                    <tr key={r.employeeId}>
                      <td className="py-2 px-2 border-b border-[#EEF2F6]">
                        <Link href={`/yazdir/bordro/${period}?tur=resmi&personel=${r.employeeId}`} target="_blank" className="font-semibold text-brand-700">{r.name}</Link>
                        <span className="block text-xs text-muted">{r.dept} · {r.insurance === "MIN_WAGE" ? "asgari" : "belirli net"}{r.cumulativeEstimated ? " · kümülatif tahmini" : ""}</span>
                      </td>
                      <td className={td}>{r.result.days}</td>
                      <td className={td}>{formatTL(b.gross)}</td>
                      <td className={td}>{formatTL(b.sgkEmployee + b.unemploymentEmployee)}</td>
                      <td className={td}>{formatTL(b.incomeTax)}</td>
                      <td className={td}>{formatTL(b.stampTax)}</td>
                      <td className={`${td} font-semibold`}>{formatTL(b.net)}</td>
                      <td className={td}>{b.bes ? formatTL(b.bes) : "—"}</td>
                      <td className={td}>{r.result.garnishmentTotal ? formatTL(r.result.garnishmentTotal) : "—"}</td>
                      <td className={`${td} font-bold text-brand-700`}>{formatTL(r.result.netToBank)}</td>
                      <td className={td}>{r.saved?.posted ? <span className="text-xs font-semibold text-ok">kesinti yazıldı</span> : r.saved ? <span className="text-xs text-muted">kaydedildi</span> : <span className="text-xs text-warn">taslak</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="font-semibold bg-[#F7F9FB]">
                  <td className="py-3 px-2">Toplam ({rows.length})</td><td />
                  <td className={td}>{formatTL(t.gross)}</td><td className={td}>{formatTL(t.sgk)}</td><td className={td}>{formatTL(t.gv)}</td><td className={td}>{formatTL(t.dv)}</td>
                  <td className={td}>{formatTL(t.net)}</td><td className={td}>{formatTL(t.bes)}</td><td className={td}>{formatTL(t.icra)}</td><td className={td}>{formatTL(t.bank)}</td><td />
                </tr>
              </tfoot>
            </table>
          ) : (
            <table className="w-full text-[13px] min-w-[1100px]">
              <thead>
                <tr className="text-xs text-muted">
                  <th className={`${th} text-left`}>Personel</th><th className={th}>Toplam ücret</th><th className={th}>Hakediş (+FM)</th><th className={th}>Kesintiler</th>
                  <th className={th}>Bankadan ödenen</th><th className={th}>Elden ödenen</th><th className={th}>Kalan</th><th className={th}>→ Bankaya</th><th className={th}>→ Elden</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const pendingDed = r.saved?.posted ? 0 : r.result.breakdown.bes + r.result.garnishmentTotal;
                  return (
                    <tr key={r.employeeId}>
                      <td className="py-2 px-2 border-b border-[#EEF2F6]">
                        <Link href={`/yazdir/bordro/${period}?tur=ic&personel=${r.employeeId}`} target="_blank" className="font-semibold text-brand-700">{r.name}</Link>
                        <span className="block text-xs text-muted">{r.dept}</span>
                      </td>
                      <td className={td}>{formatTL(r.totalNet)}</td>
                      <td className={td}>{formatTL(r.ledger.accrued)}</td>
                      <td className={td}>{formatTL(r.ledger.deductions + pendingDed)}</td>
                      <td className={td}>{formatTL(r.ledger.paidBank)}</td>
                      <td className={td}>{formatTL(r.ledger.paidCash)}</td>
                      <td className={`${td} font-semibold`}>{formatTL(r.ledger.balance - pendingDed)}</td>
                      <td className={`${td} font-bold text-brand-700`}>{formatTL(r.pay.bank)}</td>
                      <td className={`${td} font-bold text-accent-ink`}>{formatTL(r.pay.cash)}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="font-semibold bg-[#F7F9FB]">
                  <td className="py-3 px-2">Toplam ({rows.length})</td><td />
                  <td className={td}>{formatTL(t.accrued)}</td><td /><td className={td}>{formatTL(t.paidBank)}</td><td className={td}>{formatTL(t.paidCash)}</td><td />
                  <td className={td}>{formatTL(t.payBank)}</td><td className={td}>{formatTL(t.payCash)}</td>
                </tr>
              </tfoot>
            </table>
          )}
        </section>
        <p className="text-xs text-muted">
          Resmi bordro: sözleşmedeki resmi ücret, puantajdan resmi tarafa yansıtılan eksik günler ve resmi fazla mesai brütleri ile hesaplanır; gelir vergisi yıl içi kümülatif matrahla.
          Önceki ay bordrosu yoksa kümülatif matrah yıl başından aynı ücretle çalışılmış varsayılarak tahmin edilir. &quot;Kalan → Bankaya&quot; bordro netinden henüz bankadan ödenmemiş kısım, &quot;→ Elden&quot; geri kalanıdır.
        </p>
      </div>
    </>
  );
}
