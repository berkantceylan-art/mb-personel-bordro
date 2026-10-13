import { computePayroll } from "@/lib/payroll";
import type { createClient } from "@/lib/supabase/server";

type SB = Awaited<ReturnType<typeof createClient>>;

/**
 * Dönem bordrosunu hesaplayıp payroll_lines'a yazar (tüm personel ya da tek kişi).
 * Kesintileri cariye yazılmış (posted) bordrolar değiştirilmez.
 */
export async function persistPayroll(supabase: SB, companyId: string, period: string, employeeId?: string) {
  const rows = await computePayroll(supabase, period, employeeId ? { employeeId } : {});
  const posted = rows.filter((r) => r.saved?.posted);
  const toSave = rows.filter((r) => !r.saved?.posted);
  if (toSave.length) {
    const { error } = await supabase.from("payroll_lines").upsert(
      toSave.map((r) => {
        const b = r.result.breakdown;
        return {
          company_id: companyId,
          employee_id: r.employeeId,
          period,
          days: r.result.days,
          official_gross: b.gross,
          sgk_employee: b.sgkEmployee,
          unemployment_employee: b.unemploymentEmployee,
          income_tax: b.incomeTax,
          stamp_tax: b.stampTax,
          official_net: b.net,
          bes: b.bes,
          garnishment: r.result.garnishmentTotal,
          net_to_bank: r.result.netToBank,
          employer_cost: b.employerCost,
          cumulative_tax_base_after: b.cumulativeTaxBaseAfter,
          data: { result: r.result, cumulativeBefore: r.cumulativeBefore, cumulativeEstimated: r.cumulativeEstimated, insurance: r.insurance, totalNet: r.totalNet },
          posted: false,
        };
      }),
      { onConflict: "employee_id,period" },
    );
    if (error) return { error: error.message, saved: 0, posted: posted.length };
  }
  return { error: null, saved: toSave.length, posted: posted.length };
}
