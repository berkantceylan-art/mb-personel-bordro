import type { PayContract } from "@mb/core";
import type { createClient } from "@/lib/supabase/server";

type SB = Awaited<ReturnType<typeof createClient>>;

/** Her personelin verilen tarihte geçerli ücret sözleşmesi */
export async function contractsAt(supabase: SB, employeeIds: string[], onDate: string): Promise<Map<string, PayContract & { employerDiscount: boolean }>> {
  const m = new Map<string, PayContract & { employerDiscount: boolean }>();
  if (!employeeIds.length) return m;
  for (let i = 0; i < employeeIds.length; i += 200) {
    const { data } = await supabase
      .from("pay_contracts")
      .select("employee_id, valid_from, total_net, insurance_type, fixed_official_net, bes_rate, employer_discount")
      .in("employee_id", employeeIds.slice(i, i + 200))
      .lte("valid_from", onDate)
      .order("valid_from");
    for (const c of data ?? []) {
      m.set(c.employee_id, {
        totalNet: Number(c.total_net),
        insuranceType: c.insurance_type,
        fixedOfficialNet: c.fixed_official_net === null ? undefined : Number(c.fixed_official_net),
        besRate: Number(c.bes_rate),
        employerDiscount: c.employer_discount,
      });
    }
  }
  return m;
}

export const SIDE_LABEL: Record<string, string> = { OFFICIAL: "resmi", CASH: "elden", BOTH: "resmi + elden" };
