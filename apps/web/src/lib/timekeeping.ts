import {
  dailyTotals,
  daysOfPeriod,
  evaluateDay,
  isoWeekday,
  minuteToLocal,
  pairPunches,
  type DayEvaluation,
  type Punch,
  type ShiftDef,
} from "@mb/core";
import { createClient } from "@/lib/supabase/server";

type SB = Awaited<ReturnType<typeof createClient>>;

/** Supabase 1000 satır sınırını sayfalayarak aşar */
export async function fetchAll<T>(make: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await make(from, from + 999);
    if (error) throw new Error(String((error as { message?: string }).message ?? error));
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

export interface ShiftRow {
  id: string;
  name: string;
  code: string;
  color: string;
  start_time: string;
  end_time: string;
  crosses_midnight: boolean;
  break_minutes: number;
  break_paid: boolean;
  late_tolerance_min: number;
  early_leave_tolerance_min: number;
  overtime_threshold_min: number;
  weekdays: number[];
  employee_id: string | null;
  branch_id: string | null;
  active: boolean;
}

export const toShiftDef = (s: ShiftRow): ShiftDef => ({
  id: s.id,
  code: s.code,
  start: s.start_time.slice(0, 5),
  end: s.end_time.slice(0, 5),
  crossesMidnight: s.crosses_midnight,
  breakMinutes: s.break_minutes,
  breakPaid: s.break_paid,
  lateToleranceMin: s.late_tolerance_min,
  earlyToleranceMin: s.early_leave_tolerance_min,
  overtimeThresholdMin: s.overtime_threshold_min,
  weekdays: s.weekdays,
});

export interface MonthEmployee {
  id: string;
  name: string;
  cardNo: string | null;
  dept: string;
  hireDate: string;
  terminationDate: string | null;
  defaultShiftId: string | null;
}

export interface DayCell extends DayEvaluation {
  shiftCode: string | null;
  leaveCode: string | null;
  holidayName: string | null;
  punchCount: number;
  employed: boolean;
}

export interface MonthData {
  period: string;
  days: string[];
  employees: MonthEmployee[];
  shifts: Map<string, ShiftRow>;
  cells: Map<string, Map<string, DayCell>>; // employeeId → date → cell
  holidays: Map<string, { name: string; half_day: boolean }>;
  anomalies: Array<{ employeeId: string; kind: string; at: string; detail: string }>;
  unknownCards: Array<{ cardNo: string; count: number; first: string }>;
}

const shiftDate = (iso: string, delta: number) => new Date(Date.parse(iso + "T00:00:00Z") + delta * 86_400_000).toISOString().slice(0, 10);

export async function loadMonth(supabase: SB, period: string, opts: { employeeId?: string; department?: string } = {}): Promise<MonthData> {
  const days = daysOfPeriod(period);
  const first = days[0]!;
  const last = days[days.length - 1]!;

  let empQ = supabase
    .from("employees")
    .select("id, first_name, last_name, card_no, hire_date, termination_date, default_shift_id, departments(name)")
    .lte("hire_date", last)
    .or(`termination_date.is.null,termination_date.gte.${first}`)
    .order("first_name");
  if (opts.employeeId) empQ = empQ.eq("id", opts.employeeId);
  const [{ data: emps }, { data: shiftRows }, { data: hol }, leaveRows] = await Promise.all([
    empQ,
    supabase.from("shifts").select("*"),
    supabase.from("public_holidays").select("date, name, half_day").gte("date", first).lte("date", last),
    supabase
      .from("leave_requests")
      .select("employee_id, start_date, end_date, leave_types(code)")
      .eq("status", "approved")
      .lte("start_date", last)
      .gte("end_date", first),
  ]);

  let employees: MonthEmployee[] = (emps ?? []).map((e) => ({
    id: e.id,
    name: `${e.first_name} ${e.last_name}`,
    cardNo: e.card_no,
    dept: (e.departments as unknown as { name: string } | null)?.name ?? "Bölümsüz",
    hireDate: e.hire_date,
    terminationDate: e.termination_date,
    defaultShiftId: e.default_shift_id,
  }));
  if (opts.department) employees = employees.filter((e) => e.dept === opts.department);
  employees.sort((a, b) => a.dept.localeCompare(b.dept, "tr") || a.name.localeCompare(b.name, "tr"));
  const ids = employees.map((e) => e.id);

  const shifts = new Map((shiftRows ?? []).map((s) => [s.id, s as ShiftRow]));
  const holidays = new Map((hol ?? []).map((h) => [h.date as string, { name: h.name as string, half_day: h.half_day as boolean }]));

  const [assignments, punches] = ids.length
    ? await Promise.all([
        fetchAll<{ employee_id: string; work_date: string; shift_id: string | null; day_type: string | null }>((a, b) =>
          supabase.from("shift_assignments").select("employee_id, work_date, shift_id, day_type").in("employee_id", ids).gte("work_date", first).lte("work_date", last).range(a, b),
        ),
        fetchAll<{ employee_id: string | null; card_no: string; direction: "IN" | "OUT"; punched_at: string }>((a, b) =>
          supabase
            .from("attendance_punches")
            .select("employee_id, card_no, direction, punched_at")
            .in("employee_id", ids)
            .gte("punched_at", `${shiftDate(first, -1)}T00:00:00`)
            .lte("punched_at", `${shiftDate(last, 1)}T23:59:59`)
            .order("punched_at")
            .range(a, b),
        ),
      ])
    : [[], []];

  const assign = new Map<string, { shift_id: string | null; day_type: string | null }>();
  for (const a of assignments) assign.set(`${a.employee_id}|${a.work_date}`, a);
  const leaves = new Map<string, string>();
  for (const l of leaveRows.data ?? []) {
    const code = (l.leave_types as unknown as { code: string } | null)?.code ?? "IZIN";
    for (let d = l.start_date as string; d <= (l.end_date as string); d = shiftDate(d, 1)) leaves.set(`${l.employee_id}|${d}`, code);
  }

  // Okutmalar: personel id'si anahtar olarak eşleştirilir
  const corePunches: Punch[] = punches
    .filter((p) => p.employee_id)
    .map((p, i) => {
      const at = p.punched_at.slice(0, 16);
      const minute = Date.parse(at + ":00Z") / 60000;
      return { device: "", cardNo: p.employee_id!, direction: p.direction, at: minuteToLocal(minute), minute, line: i, source: "DEVICE" as const };
    });
  const paired = pairPunches(corePunches);
  const totals = new Map(dailyTotals(paired.sessions).map((t) => [`${t.cardNo}|${t.workDate}`, t]));
  const anomalyDays = new Set(
    paired.anomalies.filter((a) => a.kind === "MISSING_IN" || a.kind === "MISSING_OUT").map((a) => `${a.cardNo}|${a.at.slice(0, 10)}`),
  );
  const punchCount = new Map<string, number>();
  for (const p of corePunches) {
    const k = `${p.cardNo}|${p.at.slice(0, 10)}`;
    punchCount.set(k, (punchCount.get(k) ?? 0) + 1);
  }

  const cells = new Map<string, Map<string, DayCell>>();
  for (const e of employees) {
    const row = new Map<string, DayCell>();
    for (const d of days) {
      const k = `${e.id}|${d}`;
      const employed = d >= e.hireDate && (!e.terminationDate || d <= e.terminationDate);
      const a = assign.get(k);
      let shift: ShiftRow | undefined;
      let weeklyOff = false;
      if (a) {
        if (a.day_type === "WEEKLY_OFF" || a.day_type === "HOLIDAY") weeklyOff = true;
        else if (a.shift_id) shift = shifts.get(a.shift_id);
      } else if (e.defaultShiftId) {
        shift = shifts.get(e.defaultShiftId);
        if (shift && !shift.weekdays.includes(isoWeekday(d))) weeklyOff = true;
      } else if (isoWeekday(d) === 7) weeklyOff = true;
      const holiday = holidays.get(d);
      const ev = evaluateDay({
        date: d,
        total: totals.get(k) ?? null,
        shift: shift ? { ...toShiftDef(shift), weekdays: a?.shift_id ? [1, 2, 3, 4, 5, 6, 7] : shift.weekdays } : null,
        weeklyOff,
        holiday: !!holiday && !holiday.half_day,
        leave: leaves.has(k),
        hasAnomaly: anomalyDays.has(k),
      });
      row.set(d, {
        ...ev,
        status: employed ? ev.status : "NO_SHIFT",
        shiftCode: shift?.code ?? null,
        leaveCode: leaves.get(k) ?? null,
        holidayName: holiday?.name ?? null,
        punchCount: punchCount.get(k) ?? 0,
        employed,
      });
    }
    cells.set(e.id, row);
  }

  const inMonth = (at: string) => at.slice(0, 10) >= first && at.slice(0, 10) <= last;
  return {
    period,
    days,
    employees,
    shifts,
    cells,
    holidays,
    anomalies: paired.anomalies
      .filter((a) => a.kind !== "DUPLICATE_MERGED" && inMonth(a.at))
      .map((a) => ({ employeeId: a.cardNo, kind: a.kind, at: a.at, detail: a.detail })),
    unknownCards: [],
  };
}

export const fmtMin = (m: number) => {
  if (!m) return "0";
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return mm ? `${h},${String(Math.round((mm / 60) * 10))}` : String(h);
};

export const hhmm = (m: number) => `${Math.floor(m / 60)} sa ${String(m % 60).padStart(2, "0")} dk`;
