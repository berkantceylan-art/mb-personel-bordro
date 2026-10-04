"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { canManagePay, getSession } from "@/lib/session";
import { computePayroll } from "@/lib/payroll";

export interface RunResult {
  ok: boolean;
  message: string;
}

export async function savePayroll(_: RunResult | null, f: FormData): Promise<RunResult> {
  const s = await getSession();
  if (!canManagePay(s.role)) return { ok: false, message: "Yetkiniz yok." };
  const period = String(f.get("period"));
  const supabase = await createClient();
  const rows = await computePayroll(supabase, period);
  const posted = rows.filter((r) => r.saved?.posted);
  const toSave = rows.filter((r) => !r.saved?.posted);
  if (toSave.length) {
    const { error } = await supabase.from("payroll_lines").upsert(
      toSave.map((r) => {
        const b = r.result.breakdown;
        return {
          company_id: s.companyId,
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
    if (error) return { ok: false, message: error.message };
  }
  revalidatePath("/bordro");
  revalidatePath("/ay-sonu");
  return { ok: true, message: `${toSave.length} bordro kaydedildi.${posted.length ? ` ${posted.length} bordronun kesintileri cariye yazıldığı için değiştirilmedi.` : ""}` };
}

/** BES ve icra/nafaka kesintilerini dönem cari hesabına yazar — tek işlem (ya hepsi ya hiçbiri) */
export async function postDeductions(_: RunResult | null, f: FormData): Promise<RunResult> {
  const s = await getSession();
  if (!canManagePay(s.role)) return { ok: false, message: "Yetkiniz yok." };
  const period = String(f.get("period"));
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("post_payroll_deductions", { p_period: period });
  if (error) return { ok: false, message: error.message };
  const r = data as { lines: number; deductions: number };
  revalidatePath("/bordro");
  revalidatePath("/ay-sonu");
  revalidatePath("/icra");
  if (!r.lines) return { ok: false, message: "Yazılacak kesinti yok: önce bordroyu hesaplayıp kaydedin (veya kesintiler zaten yazılmış)." };
  return { ok: true, message: `${r.lines} bordro için ${r.deductions} kesinti cari hesaba yazıldı.` };
}

export async function unpostDeductions(_: RunResult | null, f: FormData): Promise<RunResult> {
  const s = await getSession();
  if (!canManagePay(s.role)) return { ok: false, message: "Yetkiniz yok." };
  const period = String(f.get("period"));
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("unpost_payroll_deductions", { p_period: period });
  if (error) return { ok: false, message: error.message };
  revalidatePath("/bordro");
  revalidatePath("/ay-sonu");
  revalidatePath("/icra");
  return { ok: true, message: `${(data as { voided: number }).voided} kesinti geri alındı.` };
}
