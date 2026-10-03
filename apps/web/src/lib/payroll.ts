import {
  accrualForPeriod,
  grossToNet,
  periodBounds,
  runPayroll,
  settlement,
  splitContract,
  type GarnishmentFile,
  type PayrollResult,
} from "@mb/core";
import { contractsAt } from "@/lib/contracts";
import type { createClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/timekeeping";

type SB = Awaited<ReturnType<typeof createClient>>;

export interface PayrollRow {
  employeeId: string;
  name: string;
  dept: string;
  cardNo: string | null;
  hireDate: string;
  insurance: "MIN_WAGE" | "FIXED_NET";
  totalNet: number;
  result: PayrollResult;
  cumulativeBefore: number;
  cumulativeEstimated: boolean;
  officialMissingDays: number;
  ledger: { accrued: number; paidBank: number; paidCash: number; deductions: number; balance: number; overtimeCash: number; overtimeOfficial: number; absenceCash: number; absenceOfficial: number };
  pay: { bank: number; cash: number };
  saved: { posted: boolean } | null;
}

export async function computePayroll(supabase: SB, period: string, opts: { employeeId?: string } = {}): Promise<PayrollRow[]> {
  const { start, end } = periodBounds(period);
  const month = Number(period.slice(5, 7));
  const year = period.slice(0, 4);

  let q = supabase
    .from("employees")
    .select("id, first_name, last_name, card_no, hire_date, termination_date, departments(name)")
    .lte("hire_date", end)
    .or(`termination_date.is.null,termination_date.gte.${start}`);
  if (opts.employeeId) q = q.eq("id", opts.employeeId);
  const { data: emps } = await q;
  const ids = (emps ?? []).map((e) => e.id);
  if (!ids.length) return [];

  const [contracts, allContracts, entries, prevLines, bes, garn, saved] = await Promise.all([
    contractsAt(supabase, ids, end),
    fetchAll<{ employee_id: string; valid_from: string; valid_to: string | null; total_net: number }>((a, b) =>
      supabase.from("pay_contracts").select("employee_id, valid_from, valid_to, total_net").in("employee_id", ids).lte("valid_from", end).range(a, b),
    ),
    fetchAll<{ employee_id: string; type: string; channel: string; amount: number; pay_side: string | null; gross_amount: number | null; days: number | null }>((a, b) =>
      supabase.from("ledger_entries").select("employee_id, type, channel, amount, pay_side, gross_amount, days").eq("period", period).is("voided_at", null).in("employee_id", ids).range(a, b),
    ),
    supabase.from("payroll_lines").select("employee_id, period, cumulative_tax_base_after").in("employee_id", ids).gte("period", `${year}-01`).lt("period", period),
    supabase.from("bes_enrollments").select("employee_id, rate, status, enrolled_on, status_date").in("employee_id", ids),
    supabase.from("garnishment_balances").select("id, employee_id, kind, served_at, monthly_amount, remaining, seizable_ratio, status").in("employee_id", ids).eq("status", "active"),
    supabase.from("payroll_lines").select("employee_id, posted, data").eq("period", period).in("employee_id", ids),
  ]);

  const cum = new Map<string, { period: string; v: number }>();
  for (const l of prevLines.data ?? []) {
    const cur = cum.get(l.employee_id);
    if (!cur || l.period > cur.period) cum.set(l.employee_id, { period: l.period, v: Number(l.cumulative_tax_base_after) });
  }
  const besRate = new Map<string, number>();
  for (const b of bes.data ?? []) {
    const on = b.enrolled_on <= end && (b.status === "active" || (b.status_date && b.status_date > end));
    if (on) besRate.set(b.employee_id, Number(b.rate));
    else if (!besRate.has(b.employee_id)) besRate.set(b.employee_id, 0);
  }
  const garnByEmp = new Map<string, GarnishmentFile[]>();
  for (const g of garn.data ?? []) {
    const l = garnByEmp.get(g.employee_id) ?? [];
    l.push({ id: g.id, kind: g.kind, servedAt: g.served_at, monthlyAmount: g.monthly_amount === null ? undefined : Number(g.monthly_amount), remainingDebt: g.remaining === null ? undefined : Number(g.remaining), active: true });
    garnByEmp.set(g.employee_id, l);
  }
  const savedMap = new Map((saved.data ?? []).map((s) => [s.employee_id, { posted: s.posted as boolean, result: (s.data as { result: PayrollResult }).result }]));
  const contractSlices = new Map<string, Array<{ validFrom: string; validTo: string | null; totalNet: number }>>();
  for (const c of allContracts) contractSlices.set(c.employee_id, [...(contractSlices.get(c.employee_id) ?? []), { validFrom: c.valid_from, validTo: c.valid_to, totalNet: Number(c.total_net) }]);

  const rows: PayrollRow[] = [];
  for (const e of emps ?? []) {
    const c = contracts.get(e.id);
    if (!c) continue;
    const mine = entries.filter((x) => x.employee_id === e.id);
    const sum = (f: (x: (typeof mine)[number]) => boolean, k: "amount" | "gross_amount" | "days" = "amount") => mine.filter(f).reduce((a, x) => a + Number(x[k] ?? 0), 0);
    const officialMissingDays = sum((x) => x.type === "DEDUCTION" && x.pay_side === "OFFICIAL", "days");
    const officialOvertimeGross = sum((x) => x.type === "OVERTIME" && x.pay_side === "OFFICIAL", "gross_amount");
    const employed = accrualForPeriod({ period, contracts: contractSlices.get(e.id) ?? [], hireDate: e.hire_date, terminationDate: e.termination_date }).days;

    // Kümülatif matrah: önceki bordrolardan; yoksa yıl başından beri aynı ücretle çalışılmış varsayılır
    let cumulativeBefore = cum.get(e.id)?.v ?? 0;
    let cumulativeEstimated = false;
    if (!cum.has(e.id) && month > 1) {
      const hireMonth = e.hire_date.slice(0, 4) === year ? Number(e.hire_date.slice(5, 7)) : 1;
      const priorMonths = Math.max(0, month - hireMonth);
      if (priorMonths > 0) {
        const s = splitContract(c, 1, 0);
        cumulativeBefore = grossToNet({ gross: s.official.gross, month: 1, cumulativeTaxBaseBefore: 0 }).taxBase * priorMonths;
        cumulativeEstimated = true;
      }
    }

    const savedLine = savedMap.get(e.id);
    const result = savedLine?.posted ? savedLine.result : runPayroll({
      contract: { ...c, besRate: besRate.has(e.id) ? besRate.get(e.id)! : (c.besRate ?? 0) },
      month,
      cumulativeTaxBaseBefore: cumulativeBefore,
      officialMissingDays,
      employedDays: employed,
      officialOvertimeGross,
      garnishments: garnByEmp.get(e.id) ?? [],
      employerDiscount: c.employerDiscount,
    });

    const ledger = {
      accrued: sum((x) => ["ACCRUAL", "BONUS", "OVERTIME"].includes(x.type)),
      paidBank: sum((x) => ["ADVANCE", "SALARY"].includes(x.type) && x.channel === "BANK"),
      paidCash: sum((x) => ["ADVANCE", "SALARY"].includes(x.type) && x.channel === "CASH"),
      deductions: sum((x) => ["BES", "GARNISHMENT", "DEDUCTION"].includes(x.type)),
      balance: mine.reduce((a, x) => a + (["ACCRUAL", "BONUS", "OVERTIME"].includes(x.type) ? 1 : x.type === "ADJUSTMENT" ? 1 : -1) * Number(x.amount), 0),
      overtimeCash: sum((x) => x.type === "OVERTIME" && x.pay_side === "CASH"),
      overtimeOfficial: sum((x) => x.type === "OVERTIME" && x.pay_side === "OFFICIAL"),
      absenceCash: sum((x) => x.type === "DEDUCTION" && x.pay_side === "CASH"),
      absenceOfficial: sum((x) => x.type === "DEDUCTION" && x.pay_side === "OFFICIAL"),
    };
    const posted = savedMap.get(e.id)?.posted ?? false;
    // Kesintiler henüz cariye yazılmadıysa kalan hesaplanırken düşülür
    const pendingDeductions = posted ? 0 : result.breakdown.bes + result.garnishmentTotal;
    const pay = settlement(ledger.balance - pendingDeductions, result.netToBank, ledger.paidBank);

    rows.push({
      employeeId: e.id,
      name: `${e.first_name} ${e.last_name}`,
      dept: (e.departments as unknown as { name: string } | null)?.name ?? "Bölümsüz",
      cardNo: e.card_no,
      hireDate: e.hire_date,
      insurance: c.insuranceType,
      totalNet: c.totalNet,
      result,
      cumulativeBefore,
      cumulativeEstimated,
      officialMissingDays,
      ledger,
      pay,
      saved: savedLine ? { posted: savedLine.posted } : null,
    });
  }
  return rows.sort((a, b) => a.dept.localeCompare(b.dept, "tr") || a.name.localeCompare(b.name, "tr"));
}
