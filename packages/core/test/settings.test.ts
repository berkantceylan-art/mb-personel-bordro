import { describe, expect, it } from "vitest";
import {
  allocateGarnishments,
  employerRateFor,
  evaluateDay,
  grossToNet,
  roundOvertime,
  runPayroll,
  settingsFromRow,
  tl,
  weeklySummaries,
  type DailyTotal,
  type ShiftDef,
} from "../src";

const day: ShiftDef = {
  start: "08:30", end: "18:00", crossesMidnight: false, breakMinutes: 60, breakPaid: false,
  lateToleranceMin: 10, earlyToleranceMin: 10, overtimeThresholdMin: 30, weekdays: [1, 2, 3, 4, 5, 6],
};
const tot = (workDate: string, firstIn: string, lastOut: string, worked: number): DailyTotal => ({
  cardNo: "1", workDate, firstIn, lastOut, workedMinutes: worked, outsideMinutes: 0, sessionCount: 1,
});

describe("mevzuat ayarları", () => {
  it("varsayılanlar ve satır okuma", () => {
    expect(settingsFromRow(null)).toMatchObject({ holidayExtraRate: 1, overtimeRounding: "HALF_HOUR", overtimeBasis: "WEEKLY", sgkIncentivePoints: 5 });
    expect(settingsFromRow({ holiday_extra_rate: 2, overtime_basis: "DAILY", sgk_incentive_points: 2, garnishment_after_alimony: false })).toMatchObject({
      holidayExtraRate: 2, overtimeBasis: "DAILY", sgkIncentivePoints: 2, garnishmentAfterAlimony: false, garnishmentAfterBes: false,
    });
  });

  it("fazla mesai yuvarlama: 30 dk altı yarım, üstü bir saat", () => {
    expect(roundOvertime(0, "HALF_HOUR")).toBe(0);
    expect(roundOvertime(10, "HALF_HOUR")).toBe(30);
    expect(roundOvertime(30, "HALF_HOUR")).toBe(30);
    expect(roundOvertime(31, "HALF_HOUR")).toBe(60);
    expect(roundOvertime(120, "HALF_HOUR")).toBe(120);
    expect(roundOvertime(135, "HALF_HOUR")).toBe(150);
    expect(roundOvertime(95, "EXACT")).toBe(95);
  });

  it("resmi tatil çalışması: maaşa ek bir günlük ücret (×1), ayarla ×2", () => {
    const t = tot("2026-10-29", "2026-10-29T08:30", "2026-10-29T18:00", 570);
    expect(evaluateDay({ date: "2026-10-29", total: t, shift: day, holiday: true }).overtimeRate).toBe(1);
    expect(evaluateDay({ date: "2026-10-29", total: t, shift: day, holiday: true, holidayRate: 2 }).overtimeRate).toBe(2);
  });

  it("arife: 13:00'te çıkan erken çıkış değil; 13:00 sonrası tatil çalışması", () => {
    const half = evaluateDay({ date: "2026-10-28", total: tot("2026-10-28", "2026-10-28T08:30", "2026-10-28T13:00", 270), shift: day, halfHoliday: true });
    expect(half).toMatchObject({ status: "WORKED", earlyLeaveMin: 0, overtimeMin: 0, halfHoliday: true });
    const full = evaluateDay({ date: "2026-10-28", total: tot("2026-10-28", "2026-10-28T08:30", "2026-10-28T18:00", 570), shift: day, halfHoliday: true, holidayRate: 1 });
    expect(full.overtimeMin).toBe(300);
    expect(full.overtimeRate).toBe(1);
    const noShift = evaluateDay({ date: "2026-10-28", total: tot("2026-10-28", "2026-10-28T08:00", "2026-10-28T18:00", 600), halfHoliday: true });
    expect(noShift).toMatchObject({ overtimeMin: 300, halfHoliday: true });
  });

  it("haftalık 45 saat: 6 gün × 8 saat = 3 saat fazla mesai; 11 saat üstü gün uyarısı", () => {
    const days = ["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09", "2026-10-10"].map((d) => ({ date: d, status: "WORKED" as const, workedMin: 480 }));
    days.push({ date: "2026-10-11", status: "WORKED", workedMin: 0 });
    days[1]!.workedMin = 700;
    const [w] = weeklySummaries(days);
    expect(w).toMatchObject({ weekStart: "2026-10-05", weekEnd: "2026-10-11", workedMin: 480 * 5 + 700, lastWorkedDate: "2026-10-10" });
    expect(w!.overtimeMin).toBe(480 * 5 + 700 - 2700);
    expect(w!.longDays).toEqual([{ date: "2026-10-06", workedMin: 700 }]);
  });

  it("haftalık toplama resmi tatil ve izin girmez", () => {
    const [w] = weeklySummaries([
      { date: "2026-10-26", status: "WORKED", workedMin: 600 },
      { date: "2026-10-29", status: "HOLIDAY", workedMin: 600 },
      { date: "2026-10-30", status: "LEAVE", workedMin: 0 },
    ]);
    expect(w!.workedMin).toBe(600);
    expect(w!.overtimeMin).toBe(0);
  });

  it("icra 1/4: nafaka sonrası kalan netten", () => {
    const files = [
      { id: "n", kind: "ALIMONY" as const, servedAt: "2026-01-01", monthlyAmount: tl(10000), active: true },
      { id: "i", kind: "ENFORCEMENT" as const, servedAt: "2026-02-01", remainingDebt: tl(100000), active: true },
    ];
    const net = tl(28075.5);
    expect(allocateGarnishments(net, files).lines.find((l) => l.fileId === "i")!.amount).toBe(tl(7018.88));
    expect(allocateGarnishments(net, files, 0.25, { afterAlimony: true }).lines.find((l) => l.fileId === "i")!.amount).toBe(tl(4518.88));
  });

  it("kesintiler BES sonrası neti aşamaz", () => {
    const contract = { totalNet: tl(28075.5), insuranceType: "MIN_WAGE" as const, besRate: 0.03 };
    const r = runPayroll({
      contract, month: 1, cumulativeTaxBaseBefore: 0,
      garnishments: [{ id: "n", kind: "ALIMONY", servedAt: "2026-01-01", monthlyAmount: tl(28000), active: true }],
    });
    expect(r.garnishmentTotal).toBe(r.breakdown.net - r.breakdown.bes);
    expect(r.netToBank).toBe(0);
  });

  it("SGK teşviki: 5 puan → %16,75", () => {
    expect(employerRateFor(0.2175, true, 5)).toBeCloseTo(0.1675, 6);
    expect(employerRateFor(0.2175, false, 5)).toBe(0.2175);
    const g = grossToNet({ gross: tl(33030), month: 1, cumulativeTaxBaseBefore: 0, employerRate: 0.1675 });
    expect(g.sgkEmployer).toBe(Math.round(tl(33030) * 0.1675));
    const r = runPayroll({ contract: { totalNet: tl(30000), insuranceType: "MIN_WAGE" }, month: 1, cumulativeTaxBaseBefore: 0, sgkIncentivePoints: 5 });
    expect(r.breakdown.sgkEmployer).toBe(Math.round(tl(33030) * 0.1675));
  });

  it("ay ortası zam: resmi brüt güne bölünür", () => {
    const a = { totalNet: tl(40000), insuranceType: "FIXED_NET" as const, fixedOfficialNet: tl(30000) };
    const b = { totalNet: tl(50000), insuranceType: "FIXED_NET" as const, fixedOfficialNet: tl(40000) };
    const only = (c: typeof a) => runPayroll({ contract: c, month: 1, cumulativeTaxBaseBefore: 0 }).baseGross;
    const mixed = runPayroll({ contract: b, month: 1, cumulativeTaxBaseBefore: 0, contractSegments: [{ contract: a, days: 15 }, { contract: b, days: 15 }] });
    expect(mixed.baseGross).toBe(Math.round((only(a) + only(b)) / 2));
  });
});
