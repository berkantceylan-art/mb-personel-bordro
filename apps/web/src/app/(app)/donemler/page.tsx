import Link from "next/link";
import { redirect } from "next/navigation";
import { formatTL, nextPeriod } from "@mb/core";
import { Card, PageHeader } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { canManagePay, currentPeriod, getSession, periodLabel } from "@/lib/session";
import { CreatePeriodButton } from "./CreatePeriodButton";
import { setPeriodStatus } from "./actions";

type Sum = { period: string; accrued: number | null; paid_bank: number | null; paid_cash: number | null; deductions: number | null; balance: number | null };

export default async function PeriodsPage() {
  const s = await getSession();
  if (!canManagePay(s.role)) redirect("/");
  const supabase = await createClient();
  const [{ data: periods }, { data: sums }] = await Promise.all([
    supabase.from("payroll_periods").select("period, status, employee_count, created_at").order("period", { ascending: false }),
    supabase.from("ledger_period_summary").select("period, accrued, paid_bank, paid_cash, deductions, balance"),
  ]);

  const agg = new Map<string, { accrued: number; bank: number; cash: number; ded: number; bal: number }>();
  for (const r of (sums ?? []) as Sum[]) {
    const a = agg.get(r.period) ?? { accrued: 0, bank: 0, cash: 0, ded: 0, bal: 0 };
    a.accrued += Number(r.accrued ?? 0);
    a.bank += Number(r.paid_bank ?? 0);
    a.cash += Number(r.paid_cash ?? 0);
    a.ded += Number(r.deductions ?? 0);
    a.bal += Number(r.balance ?? 0);
    agg.set(r.period, a);
  }
  const latest = periods?.[0]?.period;
  const next = latest ? nextPeriod(latest) : currentPeriod();

  return (
    <>
      <PageHeader title="Dönemler" subtitle="Her ay tek tuşla açılır; aktif personelin hakedişi ücret kayıtlarından otomatik yazılır." />
      <div className="p-6 md:p-8 flex flex-col gap-6 max-w-[1240px]">
        <Card title={`Sıradaki dönem: ${periodLabel(next)}`}>
          <p className="text-sm text-muted">
            Aktif personelin güncel ücreti üzerinden hakediş yazılır. Ay içinde işe giren / çıkan personele çalıştığı gün kadar,
            ay ortasında zam alan personele de günlere bölünerek hesaplanır. Daha önce hakedişi yazılmış personel atlanır.
          </p>
          <CreatePeriodButton period={next} label={`${periodLabel(next)} dönemini oluştur`} />
        </Card>

        <section className="bg-white border border-line rounded-[14px] overflow-x-auto">
          <table className="w-full text-sm min-w-[860px]">
            <thead>
              <tr className="text-left text-xs text-muted">
                <th className="py-3 px-4 font-semibold border-b border-line">Dönem</th>
                <th className="py-3 px-4 font-semibold border-b border-line">Durum</th>
                <th className="py-3 px-4 font-semibold border-b border-line text-right">Personel</th>
                <th className="py-3 px-4 font-semibold border-b border-line text-right">Hakediş</th>
                <th className="py-3 px-4 font-semibold border-b border-line text-right">Banka</th>
                <th className="py-3 px-4 font-semibold border-b border-line text-right">Elden</th>
                <th className="py-3 px-4 font-semibold border-b border-line text-right">Kesinti</th>
                <th className="py-3 px-4 font-semibold border-b border-line text-right">Kalan</th>
                <th className="py-3 px-4 border-b border-line"><span className="sr-only">İşlemler</span></th>
              </tr>
            </thead>
            <tbody>
              {(periods ?? []).map((p) => {
                const a = agg.get(p.period) ?? { accrued: 0, bank: 0, cash: 0, ded: 0, bal: 0 };
                const open = p.status === "open";
                return (
                  <tr key={p.period}>
                    <td className="py-3 px-4 border-b border-[#EEF2F6] font-semibold">
                      <Link href={`/donemler/${p.period}`} className="text-brand-700">{periodLabel(p.period)}</Link>
                    </td>
                    <td className="py-3 px-4 border-b border-[#EEF2F6]">
                      <span className={`text-xs font-semibold px-2 py-1 rounded-full ${open ? "bg-ok-bg text-ok" : "bg-[#EEF2F6] text-[#33414F]"}`}>{open ? "Açık" : "Kapalı"}</span>
                    </td>
                    <td className="num py-3 px-4 border-b border-[#EEF2F6] text-right">{p.employee_count}</td>
                    <td className="num py-3 px-4 border-b border-[#EEF2F6] text-right font-semibold">{formatTL(a.accrued)}</td>
                    <td className="num py-3 px-4 border-b border-[#EEF2F6] text-right">{formatTL(a.bank)}</td>
                    <td className="num py-3 px-4 border-b border-[#EEF2F6] text-right">{formatTL(a.cash)}</td>
                    <td className="num py-3 px-4 border-b border-[#EEF2F6] text-right">{formatTL(a.ded)}</td>
                    <td className="num py-3 px-4 border-b border-[#EEF2F6] text-right font-semibold">{formatTL(a.bal)}</td>
                    <td className="py-3 px-4 border-b border-[#EEF2F6]">
                      <div className="flex gap-2 justify-end">
                        {open && <CreatePeriodButton period={p.period} label="Eksikleri tamamla" variant="secondary" />}
                        <form action={setPeriodStatus}>
                          <input type="hidden" name="period" value={p.period} />
                          <input type="hidden" name="status" value={open ? "closed" : "open"} />
                          <button className="h-9 px-3 rounded-lg border border-[#D5DEE8] bg-white text-[13px] font-semibold text-[#33414F]">{open ? "Kapat" : "Yeniden aç"}</button>
                        </form>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {(periods ?? []).length === 0 && <tr><td colSpan={9} className="py-8 text-center text-muted">Henüz dönem yok.</td></tr>}
            </tbody>
          </table>
        </section>
        <p className="text-xs text-muted">Kapalı döneme avans, ödeme veya kesinti girilemez. &quot;Eksikleri tamamla&quot; sonradan eklenen personelin hakedişini yazar.</p>
      </div>
    </>
  );
}
