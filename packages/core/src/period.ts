import { roundKurus, type Kurus } from "./money";

/**
 * Dönem (ay) hakedişi.
 * - Tam ay çalışan için 30 gün esas alınır (31 çeken ayda 31. gün ücretlenmez,
 *   Şubat'ta eksik günler tamamlanır).
 * - Ay içinde işe giriş / çıkış: kıst (çalışılan takvim günü × aylık/30).
 * - Ay içinde zam: her sözleşme kendi geçerli olduğu günler kadar ücretlenir.
 */

export interface ContractSlice {
  /** ISO tarih, dahil */
  validFrom: string;
  /** ISO tarih, dahil; boş = süresiz */
  validTo?: string | null;
  totalNet: Kurus;
}

export interface AccrualInput {
  period: string; // "2026-11"
  contracts: ContractSlice[];
  hireDate: string;
  terminationDate?: string | null;
}

export interface AccrualSegment {
  from: string;
  to: string;
  days: number;
  monthly: Kurus;
  amount: Kurus;
}

export interface PeriodAccrual {
  accrual: Kurus;
  days: number;
  segments: AccrualSegment[];
}

const DAY = 86_400_000;
const toDay = (iso: string) => Math.floor(Date.parse(iso.slice(0, 10) + "T00:00:00Z") / DAY);
const fromDay = (d: number) => new Date(d * DAY).toISOString().slice(0, 10);

export function periodBounds(period: string): { start: string; end: string; monthDays: number } {
  const [y, m] = period.split("-").map(Number) as [number, number];
  const monthDays = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const mm = String(m).padStart(2, "0");
  return { start: `${y}-${mm}-01`, end: `${y}-${mm}-${String(monthDays).padStart(2, "0")}`, monthDays };
}

export function nextPeriod(period: string): string {
  const [y, m] = period.split("-").map(Number) as [number, number];
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}

export function previousPeriod(period: string): string {
  const [y, m] = period.split("-").map(Number) as [number, number];
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

export function accrualForPeriod(input: AccrualInput): PeriodAccrual {
  const { start, end, monthDays } = periodBounds(input.period);
  const pStart = toDay(start);
  const pEnd = toDay(end);
  const activeStart = Math.max(pStart, toDay(input.hireDate));
  const activeEnd = Math.min(pEnd, input.terminationDate ? toDay(input.terminationDate) : pEnd);
  if (activeEnd < activeStart) return { accrual: 0, days: 0, segments: [] };

  const sorted = [...input.contracts].sort((a, b) => a.validFrom.localeCompare(b.validFrom));
  const segments: AccrualSegment[] = [];
  sorted.forEach((c, i) => {
    const nextFrom = sorted[i + 1] ? toDay(sorted[i + 1]!.validFrom) - 1 : Number.POSITIVE_INFINITY;
    const cTo = Math.min(c.validTo ? toDay(c.validTo) : Number.POSITIVE_INFINITY, nextFrom);
    const from = Math.max(activeStart, toDay(c.validFrom));
    const to = Math.min(activeEnd, cTo);
    if (to < from) return;
    segments.push({ from: fromDay(from), to: fromDay(to), days: to - from + 1, monthly: c.totalNet, amount: 0 });
  });

  let covered = segments.reduce((a, s) => a + s.days, 0);
  const fullMonth = activeStart === pStart && activeEnd === pEnd && covered === monthDays;
  if (fullMonth && segments.length) {
    segments[segments.length - 1]!.days += 30 - monthDays;
    covered = 30;
  } else if (covered > 30 && segments.length) {
    segments[segments.length - 1]!.days -= covered - 30;
    covered = 30;
  }

  for (const s of segments) s.amount = roundKurus((s.monthly / 30) * s.days);
  return { accrual: segments.reduce((a, s) => a + s.amount, 0), days: covered, segments };
}

/* ------------------------------------------------------------------ */
/* Zam                                                                 */
/* ------------------------------------------------------------------ */

export type RaiseKind = "PERCENT" | "AMOUNT" | "SET";

export interface RaiseRule {
  kind: RaiseKind;
  /** PERCENT: 25 = %25 · AMOUNT: kuruş artış · SET: yeni toplam (kuruş) */
  value: number;
  /** Kuruş cinsinden yuvarlama adımı (ör. 50000 = ₺500). 0/boş = yuvarlama yok */
  roundTo?: Kurus;
}

export function applyRaise(current: Kurus, rule: RaiseRule): Kurus {
  let next: number;
  if (rule.kind === "PERCENT") next = current * (1 + rule.value / 100);
  else if (rule.kind === "AMOUNT") next = current + rule.value;
  else next = rule.value;
  const step = rule.roundTo ?? 0;
  next = step > 0 ? Math.round(next / step) * step : roundKurus(next);
  return Math.max(0, next);
}

export const raisePercent = (before: Kurus, after: Kurus): number =>
  before > 0 ? Math.round(((after - before) / before) * 10000) / 100 : 0;
