import type { DailyTotal } from "./attendance";
import { roundKurus, type Kurus } from "./money";

/* ------------------------------------------------------------------ */
/* Vardiyaya göre gün değerlendirme                                    */
/* ------------------------------------------------------------------ */

export interface ShiftDef {
  id?: string;
  code?: string;
  start: string; // "08:30"
  end: string; // "18:00"
  crossesMidnight: boolean;
  breakMinutes: number;
  breakPaid: boolean;
  lateToleranceMin: number;
  earlyToleranceMin: number;
  overtimeThresholdMin: number;
  /** ISO gün no 1=Pzt … 7=Paz */
  weekdays: number[];
}

const hm = (t: string) => {
  const [h, m] = t.split(":").map(Number) as [number, number];
  return h * 60 + m;
};
const minOfDay = (local: string) => hm(local.slice(11, 16));
const dayDiff = (a: string, b: string) =>
  (Date.parse(b.slice(0, 10) + "T00:00:00Z") - Date.parse(a.slice(0, 10) + "T00:00:00Z")) / 86_400_000;

/** Vardiyanın planlanan net çalışma süresi (dakika) */
export function shiftNetMinutes(s: ShiftDef): number {
  let span = hm(s.end) - hm(s.start);
  if (s.crossesMidnight || span <= 0) span += 1440;
  return span - (s.breakPaid ? 0 : s.breakMinutes);
}

/** ISO gün numarası (1=Pzt … 7=Paz) */
export function isoWeekday(date: string): number {
  const d = new Date(date.slice(0, 10) + "T00:00:00Z").getUTCDay();
  return d === 0 ? 7 : d;
}

export type DayStatus = "WORKED" | "INCOMPLETE" | "ABSENT" | "WEEKLY_OFF" | "HOLIDAY" | "LEAVE" | "NO_SHIFT";

export interface DayEvaluation {
  date: string;
  status: DayStatus;
  workedMin: number;
  lateMin: number;
  earlyLeaveMin: number;
  overtimeMin: number;
  /** Tatil günü çalışması ise 2, normal fazla mesai 1.5 */
  overtimeRate: number;
}

export interface EvaluateDayInput {
  date: string;
  total?: DailyTotal | null;
  shift?: ShiftDef | null;
  /** Bu gün planlı hafta tatili mi (atama veya vardiya günleri) */
  weeklyOff?: boolean;
  holiday?: boolean;
  leave?: boolean;
  /** Eşleşmemiş (anomali) okutma var mı */
  hasAnomaly?: boolean;
}

export function evaluateDay(i: EvaluateDayInput): DayEvaluation {
  const base = { date: i.date, workedMin: 0, lateMin: 0, earlyLeaveMin: 0, overtimeMin: 0, overtimeRate: 1.5 };
  const t = i.total;
  const breakUnpaid = i.shift && !i.shift.breakPaid ? i.shift.breakMinutes : 0;
  // Molayı okutmadan kullanan personelden ücretsiz mola düşülür
  const net = t ? Math.max(0, t.workedMinutes - Math.max(0, breakUnpaid - t.outsideMinutes)) : 0;

  if (i.leave) return { ...base, status: "LEAVE", workedMin: net };
  const offDay = i.holiday || i.weeklyOff || (i.shift ? !i.shift.weekdays.includes(isoWeekday(i.date)) : false);
  if (offDay) {
    const threshold = i.shift?.overtimeThresholdMin ?? 30;
    return {
      ...base,
      status: i.holiday ? "HOLIDAY" : "WEEKLY_OFF",
      workedMin: net,
      overtimeMin: net >= threshold ? net : 0,
      overtimeRate: i.holiday ? 2 : 1.5,
    };
  }
  if (!i.shift) return { ...base, status: t ? "WORKED" : i.hasAnomaly ? "INCOMPLETE" : "NO_SHIFT", workedMin: net };
  if (!t) return { ...base, status: i.hasAnomaly ? "INCOMPLETE" : "ABSENT" };

  const s = i.shift;
  const start = hm(s.start);
  const firstIn = minOfDay(t.firstIn);
  const late = firstIn - start;
  const end = hm(s.end) + (s.crossesMidnight || hm(s.end) <= start ? 1440 : 0);
  const lastOut = minOfDay(t.lastOut) + dayDiff(t.workDate, t.lastOut) * 1440;
  const early = end - lastOut;
  const planned = shiftNetMinutes(s);
  const over = net - planned;

  return {
    ...base,
    status: i.hasAnomaly ? "INCOMPLETE" : "WORKED",
    workedMin: net,
    lateMin: late > s.lateToleranceMin ? late : 0,
    earlyLeaveMin: early > s.earlyToleranceMin ? early : 0,
    overtimeMin: over >= s.overtimeThresholdMin ? over : 0,
  };
}

/* ------------------------------------------------------------------ */
/* Fazla mesai ücreti                                                  */
/* ------------------------------------------------------------------ */

/** Saatlik ücret = aylık / 225 (haftalık 45 saat). */
export function overtimePay(monthlyTotal: Kurus, minutes: number, rate: number): Kurus {
  return roundKurus((monthlyTotal / 225) * (minutes / 60) * rate);
}

/* ------------------------------------------------------------------ */
/* Yıllık izin                                                         */
/* ------------------------------------------------------------------ */

const yearsBetween = (from: string, to: string) => {
  const a = new Date(from.slice(0, 10) + "T00:00:00Z");
  const b = new Date(to.slice(0, 10) + "T00:00:00Z");
  let y = b.getUTCFullYear() - a.getUTCFullYear();
  if (b.getUTCMonth() < a.getUTCMonth() || (b.getUTCMonth() === a.getUTCMonth() && b.getUTCDate() < a.getUTCDate())) y--;
  return y;
};

/** Kıdem yılına göre yıllık izin (İş K. 53): 1-5 yıl 14, 5-15 arası 20, 15+ 26; 18 yaş altı / 50 yaş üstü en az 20. */
export function annualLeaveForYear(seniorityYear: number, ageAtAnniversary?: number): number {
  let days = seniorityYear <= 5 ? 14 : seniorityYear < 15 ? 20 : 26;
  if (ageAtAnniversary !== undefined && (ageAtAnniversary <= 18 || ageAtAnniversary >= 50)) days = Math.max(days, 20);
  return days;
}

export interface LeaveEntitlement {
  completedYears: number;
  earned: number;
  nextAnniversary: string;
  nextYearDays: number;
}

export function annualLeaveEntitlement(hireDate: string, asOf: string, birthDate?: string | null): LeaveEntitlement {
  const years = Math.max(0, yearsBetween(hireDate, asOf));
  let earned = 0;
  const [hy, hmn, hd] = hireDate.slice(0, 10).split("-");
  for (let k = 1; k <= years; k++) {
    const anniv = `${Number(hy) + k}-${hmn}-${hd}`;
    const age = birthDate ? yearsBetween(birthDate, anniv) : undefined;
    earned += annualLeaveForYear(k, age);
  }
  const next = `${Number(hy) + years + 1}-${hmn}-${hd}`;
  return {
    completedYears: years,
    earned,
    nextAnniversary: next,
    nextYearDays: annualLeaveForYear(years + 1, birthDate ? yearsBetween(birthDate, next) : undefined),
  };
}

/** İzin gün sayısı: hafta tatili ve resmi tatiller sayılmaz (yıllık izin kuralı). */
export function countLeaveDays(
  start: string,
  end: string,
  opts: { holidays?: Set<string>; offWeekdays?: number[]; halfDay?: boolean } = {},
): number {
  const off = opts.offWeekdays ?? [7];
  let n = 0;
  for (let d = Date.parse(start + "T00:00:00Z"); d <= Date.parse(end + "T00:00:00Z"); d += 86_400_000) {
    const iso = new Date(d).toISOString().slice(0, 10);
    if (off.includes(isoWeekday(iso)) || opts.holidays?.has(iso)) continue;
    n++;
  }
  return opts.halfDay && n === 1 ? 0.5 : n;
}

/** "2026-10" ayının tüm günleri */
export function daysOfPeriod(period: string): string[] {
  const [y, m] = period.split("-").map(Number) as [number, number];
  const n = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: n }, (_, i) => `${period}-${String(i + 1).padStart(2, "0")}`);
}
