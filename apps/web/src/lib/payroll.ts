import {
  accrualForPeriod,
  grossToNet,
  periodBounds,
  runPayroll,
  settlement,
  splitContract,
  type GarnishmentFile,
  type PayContract,
  type PayrollResult,
} from "@mb/core";
import { contractsAt } from "@/lib/contracts";
import type { createClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/timekeeping";
import { getCompanySettings } from "@/lib/settings";
import { legalParams } from "@/lib/legal";
import type { LegalParams } from "@mb/core";

type SB = Awaited<ReturnType<typeof createClient>>;

export interface PayrollRow {
  employeeId: string;
  name: string;
  dept: string;
  cardNo: string | null;
  hireDate: string;
  insurance: "MIN_WAGE" | "FIXED_NET" | "NONE";
  /** Engellilik indirimi derecesi (0 = yok) ve işveren teşviki */
  disability: { degree: 0 | 1 | 2 | 3; incentive: boolean } | null;
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

  const [contracts, allContracts, entries, prevLines, bes, garn, saved, settings, legal, history, disab] = await Promise.all([
    contractsAt(supabase, ids, end),
    fetchAll<{ employee_id: string; valid_from: string; valid_to: string | null; total_net: number; insurance_type: "MIN_WAGE" | "FIXED_NET" | "NONE"; fixed_official_net: number | null; bes_rate: number }>((a, b) =>
      supabase.from("pay_contracts").select("employee_id, valid_from, valid_to, total_net, insurance_type, fixed_official_net, bes_rate").in("employee_id", ids).lte("valid_from", end).range(a, b),
    ),
    fetchAll<{ employee_id: string; type: string; channel: string; amount: number; pay_side: string | null; gross_amount: number | null; days: number | null }>((a, b) =>
      supabase.from("ledger_entries").select("employee_id, type, channel, amount, pay_side, gross_amount, days").eq("period", period).is("voided_at", null).in("employee_id", ids).range(a, b),
    ),
    supabase.from("payroll_lines").select("employee_id, period, cumulative_tax_base_after").in("employee_id", ids).gte("period", `${year}-01`).lt("period", period),
    supabase.from("bes_enrollments").select("employee_id, rate, status, enrolled_on, status_date").in("employee_id", ids),
    supabase.from("garnishment_balances").select("id, employee_id, kind, served_at, monthly_amount, remaining, seizable_ratio, status").in("employee_id", ids).eq("status", "active"),
    supabase.from("payroll_lines").select("employee_id, posted, data").eq("period", period).in("employee_id", ids),
    getCompanySettings(supabase),
    legalParams(supabase, Number(year)),
    supabase.from("payroll_history").select("employee_id, period, gross, sgk_employee, unemployment_employee, cumulative_tax_base_after").in("employee_id", ids).gte("period", `${year}-01`).lt("period", period),
    supabase.rpc("pay_disability"),
  ]);
  // Engelli personel (20270122000000_disabled_payroll.sql yoksa boş)
  const disability = new Map<string, { degree: 0 | 1 | 2 | 3; incentive: boolean }>();
  for (const d of ((disab.error ? [] : disab.data) ?? []) as Array<{ employee_id: string; tax_degree: number; incentive: boolean; report_until: string | null }>) {
    const valid = !d.report_until || d.report_until >= start;
    disability.set(d.employee_id, { degree: (valid ? Math.max(0, Math.min(3, d.tax_degree)) : 0) as 0 | 1 | 2 | 3, incentive: valid && d.incentive });
  }
  const params = legal.params;

  const cum = latestCumulative([...historyCumulative(history.data ?? []), ...(prevLines.data ?? [])]);
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
    const officialBonusGross = sum((x) => x.type === "BONUS" && x.pay_side === "OFFICIAL", "gross_amount");
    const acc = accrualForPeriod({ period, contracts: contractSlices.get(e.id) ?? [], hireDate: e.hire_date, terminationDate: e.termination_date });
    const employed = acc.days;
    // Ay ortası ücret değişikliği: her dilimin sözleşmesi, resmi brüt güne bölünür
    const mineContracts = allContracts.filter((x) => x.employee_id === e.id).sort((a, b) => a.valid_from.localeCompare(b.valid_from));
    const contractSegments = acc.segments.length > 1
      ? acc.segments.map((sg) => {
          const k = mineContracts.filter((x) => x.valid_from <= sg.from).at(-1) ?? mineContracts[0]!;
          return {
            days: sg.days,
            contract: {
              totalNet: Number(k.total_net),
              insuranceType: k.insurance_type,
              fixedOfficialNet: k.fixed_official_net === null ? undefined : Number(k.fixed_official_net),
              besRate: besRate.has(e.id) ? besRate.get(e.id)! : Number(k.bes_rate),
            } as PayContract,
          };
        })
      : undefined;

    // Kümülatif matrah: önceki bordrolardan; yoksa yıl başından beri aynı ücretle çalışılmış varsayılır
    const { value: cumulativeBefore, estimated: cumulativeEstimated } = resolveCumulative(cum.get(e.id), c, e.hire_date, period, params);

    const savedLine = savedMap.get(e.id);
    const result = savedLine?.posted ? savedLine.result : runPayroll({
      contract: { ...c, besRate: besRate.has(e.id) ? besRate.get(e.id)! : (c.besRate ?? 0) },
      month,
      cumulativeTaxBaseBefore: cumulativeBefore,
      officialMissingDays,
      employedDays: employed,
      officialOvertimeGross,
      officialBonusGross,
      garnishments: garnByEmp.get(e.id) ?? [],
      employerDiscount: c.employerDiscount,
      sgkIncentivePoints: settings.sgkIncentivePoints,
      contractSegments,
      garnishmentAfterAlimony: settings.garnishmentAfterAlimony,
      garnishmentAfterBes: settings.garnishmentAfterBes,
      disabilityDegree: disability.get(e.id)?.degree ?? 0,
      disabledIncentive: disability.get(e.id)?.incentive ?? false,
      params,
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
      disability: disability.get(e.id) ?? null,
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

function latestCumulative(lines: Array<{ employee_id: string; period: string; cumulative_tax_base_after: number }>) {
  const cum = new Map<string, { period: string; v: number }>();
  // Aynı dönemde hem arşiv hem sistem bordrosu varsa sonra gelen (sistem) geçerli
  for (const l of lines) {
    const cur = cum.get(l.employee_id);
    if (!cur || l.period >= cur.period) cum.set(l.employee_id, { period: l.period, v: Number(l.cumulative_tax_base_after) });
  }
  return cum;
}

/**
 * Arşivden okutulan eski bordrolar (payroll_history): kümülatif matrah okunduysa o, okunmadıysa
 * yıl içinde (brüt − SGK − işsizlik) toplanarak bulunur.
 */
function historyCumulative(rows: Array<{ employee_id: string; period: string; gross: number; sgk_employee: number; unemployment_employee: number; cumulative_tax_base_after: number | null }>) {
  const out: Array<{ employee_id: string; period: string; cumulative_tax_base_after: number }> = [];
  const run = new Map<string, number>();
  for (const r of [...rows].sort((a, b) => a.employee_id.localeCompare(b.employee_id) || a.period.localeCompare(b.period))) {
    const base = Math.max(0, Number(r.gross) - Number(r.sgk_employee) - Number(r.unemployment_employee));
    const v = r.cumulative_tax_base_after !== null && Number(r.cumulative_tax_base_after) > 0 ? Number(r.cumulative_tax_base_after) : (run.get(r.employee_id) ?? 0) + base;
    run.set(r.employee_id, v);
    out.push({ employee_id: r.employee_id, period: r.period, cumulative_tax_base_after: v });
  }
  return out;
}

/**
 * Kümülatif GV matrahı. Önceki bordro varsa ondan; aradaki kaydedilmemiş aylar (ve hiç bordro yoksa
 * yıl başından / işe girişten bu yana geçen aylar) aynı resmi ücretle çalışılmış kabul edilerek eklenir.
 * Böylece bir ay atlanınca personel vergi dilimine geç girmez.
 */
function resolveCumulative(prev: { period: string; v: number } | undefined, c: PayContract, hireDate: string, period: string, params: LegalParams) {
  const month = Number(period.slice(5, 7));
  const year = period.slice(0, 4);
  const hireMonth = hireDate.slice(0, 4) === year ? Number(hireDate.slice(5, 7)) : hireDate.slice(0, 4) > year ? 13 : 1;
  const fromMonth = prev ? Math.max(Number(prev.period.slice(5, 7)) + 1, hireMonth) : hireMonth;
  const missing = Math.max(0, month - fromMonth);
  const base = prev?.v ?? 0;
  if (!missing) return { value: base, estimated: false };
  const s = splitContract(c, 1, 0, params);
  const monthly = grossToNet({ gross: s.official.gross, month: 1, cumulativeTaxBaseBefore: 0, params }).taxBase;
  return { value: base + monthly * missing, estimated: true };
}

/**
 * Fazla mesai / eksik gün gibi ay içi hesaplar için personelin o döneme kadarki kümülatif GV matrahı.
 * Bordroyla aynı kural: önceki kaydedilmiş bordro, yoksa tahmin.
 */
export async function cumulativeBases(
  supabase: SB,
  period: string,
  employees: Array<{ id: string; hire_date: string }>,
  contracts: Map<string, PayContract>,
): Promise<Map<string, number>> {
  const ids = employees.map((e) => e.id);
  const out = new Map<string, number>();
  if (!ids.length) return out;
  const [{ data }, { data: hist }] = await Promise.all([
    supabase.from("payroll_lines").select("employee_id, period, cumulative_tax_base_after").in("employee_id", ids).gte("period", `${period.slice(0, 4)}-01`).lt("period", period),
    supabase.from("payroll_history").select("employee_id, period, gross, sgk_employee, unemployment_employee, cumulative_tax_base_after").in("employee_id", ids).gte("period", `${period.slice(0, 4)}-01`).lt("period", period),
  ]);
  const cum = latestCumulative([...historyCumulative(hist ?? []), ...(data ?? [])]);
  const { params } = await legalParams(supabase, Number(period.slice(0, 4)));
  for (const e of employees) {
    const c = contracts.get(e.id);
    if (c) out.set(e.id, resolveCumulative(cum.get(e.id), c, e.hire_date, period, params).value);
  }
  return out;
}
