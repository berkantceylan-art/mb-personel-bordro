import "server-only";

import { loadMonth, type MonthData } from "@/lib/timekeeping";
import { overtimeSuggestions } from "@/lib/overtime";
import type { createClient } from "@/lib/supabase/server";

type SB = Awaited<ReturnType<typeof createClient>>;

export { ISSUE } from "@/lib/att-issues";

export const prevPeriod = (p: string) => {
  const [y, m] = p.split("-").map(Number) as [number, number];
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
};
const istanbulToday = () => new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10);

/** Bir ayın günlük kayıtlarını hesaplar (bugün ve sonrası hariç: gün bitmeden hata sayılmaz) */
export function buildAttRows(m: MonthData, prev: MonthData | null, today = istanbulToday()) {
  const ot = new Map<string, { minutes: number; rate: number }>();
  for (const s of overtimeSuggestions(m, prev).suggestions) ot.set(`${s.employeeId}|${s.date}`, { minutes: s.minutes, rate: s.rate });
  const anomaly = new Map<string, string>();
  for (const a of m.anomalies) if (a.kind === "MISSING_IN" || a.kind === "MISSING_OUT") anomaly.set(`${a.employeeId}|${a.at.slice(0, 10)}`, a.kind);
  const rows: Record<string, unknown>[] = [];
  for (const e of m.employees) {
    const cells = m.cells.get(e.id);
    if (!cells) continue;
    for (const c of cells.values()) {
      if (!c.employed || c.date >= today) continue;
      const k = `${e.id}|${c.date}`;
      const issues: string[] = [];
      if (c.status === "INCOMPLETE") issues.push(anomaly.get(k) ?? "MISSING_OUT");
      if (c.status === "ABSENT") issues.push("ABSENT");
      if (c.lateMin > 0) issues.push("LATE");
      if (c.earlyLeaveMin > 0) issues.push("EARLY");
      const o = ot.get(k);
      if (o && o.minutes > 0) issues.push("OVERTIME");
      if (c.status === "LEAVE" && c.punchCount > 0) issues.push("LEAVE_PRESENT");
      if (!c.shiftCode && c.workedMin > 0 && c.status === "WORKED") issues.push("NO_SHIFT");
      if (c.workedMin > 660) issues.push("LONG_DAY");
      const sh = c.shiftCode ? [...m.shifts.values()].find((s) => s.code === c.shiftCode) : undefined;
      rows.push({
        employee_id: e.id, work_date: c.date, shift_code: c.shiftCode, shift_start: sh?.start_time?.slice(0, 5) ?? null, shift_end: sh?.end_time?.slice(0, 5) ?? null,
        status: c.status, leave_code: c.leaveCode, first_in: c.firstIn, last_out: c.lastOut, worked_min: c.workedMin, late_min: c.lateMin,
        early_min: c.earlyLeaveMin, overtime_min: o?.minutes ?? 0, overtime_rate: o?.rate ?? 1.5, punch_count: c.punchCount, issues,
      });
    }
  }
  return rows;
}

/** Ayın kayıtlarını hesaplayıp yazar. companyId: personelin şirketi (tek şirket) */
export async function syncAttMonth(sb: SB, companyId: string, period: string, employeeId?: string, opts: { withPrev?: boolean } = {}): Promise<number> {
  // Önceki ay yalnız haftalık fazla mesainin ay başındaki yarım haftası için gerekir; tek gün düzeltmesinde ayın ilk haftası dışında atlanır
  const withPrev = opts.withPrev ?? true;
  const [m, prev] = await Promise.all([loadMonth(sb, period, { employeeId }), withPrev ? loadMonth(sb, prevPeriod(period), { employeeId }).catch(() => null) : Promise.resolve(null)]);
  const rows = buildAttRows(m, prev);
  let n = 0;
  for (let i = 0; i < rows.length; i += 400) {
    const { data, error } = await sb.rpc("att_days_sync", { p_company: companyId, p_rows: rows.slice(i, i + 400) });
    if (error) throw new Error(error.message);
    n += Number(data ?? 0);
  }
  return n;
}
