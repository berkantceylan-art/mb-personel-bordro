import { describe, expect, it } from "vitest";
import {
  annualLeaveEntitlement,
  countLeaveDays,
  evaluateDay,
  overtimePay,
  shiftNetMinutes,
  tl,
  type DailyTotal,
  type ShiftDef,
} from "../src";

const day: ShiftDef = {
  start: "08:30", end: "18:00", crossesMidnight: false, breakMinutes: 60, breakPaid: false,
  lateToleranceMin: 10, earlyToleranceMin: 10, overtimeThresholdMin: 30, weekdays: [1, 2, 3, 4, 5, 6],
};
const night: ShiftDef = { ...day, start: "19:00", end: "07:30", crossesMidnight: true, weekdays: [1, 2, 3, 4, 5] };
const tot = (workDate: string, firstIn: string, lastOut: string, worked: number, outside = 0): DailyTotal => ({
  cardNo: "1", workDate, firstIn, lastOut, workedMinutes: worked, outsideMinutes: outside, sessionCount: 1,
});

describe("vardiya", () => {
  it("net süre", () => {
    expect(shiftNetMinutes(day)).toBe(510); // 9,5 saat − 1 saat mola
    expect(shiftNetMinutes(night)).toBe(690); // 12,5 − 1 = 11,5 saat
  });
});

describe("gün değerlendirme", () => {
  it("zamanında, molayı okutmadan: mola düşülür, fazla mesai yok", () => {
    const r = evaluateDay({ date: "2026-10-05", total: tot("2026-10-05", "2026-10-05T08:25", "2026-10-05T18:05", 580), shift: day });
    expect(r).toMatchObject({ status: "WORKED", workedMin: 520, lateMin: 0, earlyLeaveMin: 0, overtimeMin: 0 });
  });

  it("geç gelme ve fazla mesai", () => {
    const r = evaluateDay({ date: "2026-10-05", total: tot("2026-10-05", "2026-10-05T08:55", "2026-10-05T20:00", 665), shift: day });
    expect(r.lateMin).toBe(25);
    expect(r.overtimeMin).toBe(95); // 605 net − 510
  });

  it("gece vardiyası, erken çıkış", () => {
    const r = evaluateDay({ date: "2026-10-05", total: tot("2026-10-05", "2026-10-05T19:00", "2026-10-06T06:30", 690), shift: night });
    expect(r.earlyLeaveMin).toBe(60);
    expect(r.workedMin).toBe(630);
  });

  it("devamsızlık ve hafta tatili mesaisi", () => {
    expect(evaluateDay({ date: "2026-10-06", shift: day }).status).toBe("ABSENT");
    const sun = evaluateDay({ date: "2026-10-04", total: tot("2026-10-04", "2026-10-04T09:00", "2026-10-04T13:00", 240), shift: day });
    expect(sun).toMatchObject({ status: "WEEKLY_OFF", overtimeMin: 180, overtimeRate: 1.5 });
    const hol = evaluateDay({ date: "2026-10-29", total: tot("2026-10-29", "2026-10-29T09:00", "2026-10-29T13:00", 240), shift: day, holiday: true });
    expect(hol).toMatchObject({ status: "HOLIDAY", overtimeRate: 1 });
  });
});

describe("fazla mesai ücreti", () => {
  it("aylık/225 × saat × oran", () => {
    expect(overtimePay(tl(90000), 120, 1.5)).toBe(tl(1200)); // 400/saat × 2 × 1,5
  });
});

describe("yıllık izin", () => {
  it("kıdeme göre birikir", () => {
    const r = annualLeaveEntitlement("2018-09-14", "2026-10-03");
    // 8 yıl: 5×14 + 3×20
    expect(r).toMatchObject({ completedYears: 8, earned: 130, nextAnniversary: "2027-09-14", nextYearDays: 20 });
    expect(annualLeaveEntitlement("2026-01-08", "2026-10-03").earned).toBe(0);
  });

  it("50 yaş üstü en az 20 gün", () => {
    const r = annualLeaveEntitlement("2024-01-01", "2026-06-01", "1970-01-01");
    expect(r.earned).toBe(40);
  });

  it("izin günü: pazar ve resmi tatil sayılmaz", () => {
    // 26 Ekim Pzt – 31 Ekim Cmt; 29 Ekim resmi tatil
    expect(countLeaveDays("2026-10-26", "2026-11-01", { holidays: new Set(["2026-10-29"]) })).toBe(5);
    expect(countLeaveDays("2026-10-26", "2026-10-26", { halfDay: true })).toBe(0.5);
  });
});
