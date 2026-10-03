import { createClient } from "@/lib/supabase/server";

export interface SalaryChange {
  id: string;
  employee_id: string;
  first_name: string;
  last_name: string;
  department_name: string | null;
  effective_date: string;
  period: string;
  previous_total_net: number;
  total_net: number;
  increase: number;
  increase_pct: number;
  raise_batch_id: string | null;
  change_reason: string | null;
}

export interface RaiseGroup {
  key: string;
  count: number;
  increase: number;
  before: number;
  after: number;
  avgPct: number;
}

export async function loadRaises(year: number, department?: string) {
  const supabase = await createClient();
  let q = supabase
    .from("salary_changes")
    .select("id, employee_id, first_name, last_name, department_name, effective_date, period, previous_total_net, total_net, increase, increase_pct, raise_batch_id, change_reason")
    .gte("effective_date", `${year}-01-01`)
    .lte("effective_date", `${year}-12-31`)
    .order("effective_date", { ascending: false });
  if (department) q = q.eq("department_name", department);
  const { data } = await q;
  const rows: SalaryChange[] = (data ?? []).map((r) => ({
    ...r,
    previous_total_net: Number(r.previous_total_net),
    total_net: Number(r.total_net),
    increase: Number(r.increase),
    increase_pct: Number(r.increase_pct ?? 0),
  }));
  return rows;
}

export function groupRaises(rows: SalaryChange[], keyOf: (r: SalaryChange) => string): RaiseGroup[] {
  const m = new Map<string, RaiseGroup & { pctSum: number }>();
  for (const r of rows) {
    const k = keyOf(r);
    const g = m.get(k) ?? { key: k, count: 0, increase: 0, before: 0, after: 0, avgPct: 0, pctSum: 0 };
    g.count++;
    g.increase += r.increase;
    g.before += r.previous_total_net;
    g.after += r.total_net;
    g.pctSum += r.increase_pct;
    m.set(k, g);
  }
  return [...m.values()].map(({ pctSum, ...g }) => ({ ...g, avgPct: Math.round((pctSum / g.count) * 100) / 100 }));
}
