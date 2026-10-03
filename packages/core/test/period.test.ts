import { describe, expect, it } from "vitest";
import { accrualForPeriod, applyRaise, nextPeriod, periodBounds, raisePercent, tl } from "../src";

const c = (validFrom: string, total: number, validTo?: string) => ({ validFrom, validTo, totalNet: tl(total) });

describe("dönem yardımcıları", () => {
  it("ay sınırları ve sonraki dönem", () => {
    expect(periodBounds("2026-02")).toEqual({ start: "2026-02-01", end: "2026-02-28", monthDays: 28 });
    expect(nextPeriod("2026-12")).toBe("2027-01");
    expect(nextPeriod("2026-10")).toBe("2026-11");
  });
});

describe("dönem hakedişi", () => {
  it("tam ay = 30 gün (31 çeken ay)", () => {
    const r = accrualForPeriod({ period: "2026-10", contracts: [c("2024-01-01", 100000)], hireDate: "2021-09-21" });
    expect(r.days).toBe(30);
    expect(r.accrual).toBe(tl(100000));
  });

  it("tam ay = 30 gün (Şubat)", () => {
    const r = accrualForPeriod({ period: "2026-02", contracts: [c("2024-01-01", 60000)], hireDate: "2020-01-01" });
    expect(r.days).toBe(30);
    expect(r.accrual).toBe(tl(60000));
  });

  it("ay içinde işe giriş: kıst hakediş", () => {
    // 16 Kasım'da başlayan: 16-30 = 15 gün
    const r = accrualForPeriod({ period: "2026-11", contracts: [c("2026-11-16", 90000)], hireDate: "2026-11-16" });
    expect(r.days).toBe(15);
    expect(r.accrual).toBe(tl(45000));
  });

  it("ay içinde işten çıkış", () => {
    const r = accrualForPeriod({
      period: "2026-11",
      contracts: [c("2024-01-01", 60000)],
      hireDate: "2024-01-01",
      terminationDate: "2026-11-10",
    });
    expect(r.days).toBe(10);
    expect(r.accrual).toBe(tl(20000));
  });

  it("ay ortasında zam: günlere bölünür", () => {
    // 1-15 Kasım 100.000, 16-30 Kasım 130.000
    const r = accrualForPeriod({
      period: "2026-11",
      contracts: [c("2025-01-01", 100000, "2026-11-15"), c("2026-11-16", 130000)],
      hireDate: "2021-01-01",
    });
    expect(r.segments.map((s) => s.days)).toEqual([15, 15]);
    expect(r.accrual).toBe(tl(115000));
  });

  it("ayın 1'inde zam: yeni ücret tam uygulanır", () => {
    const r = accrualForPeriod({
      period: "2026-12",
      contracts: [c("2025-01-01", 100000), c("2026-12-01", 125000)],
      hireDate: "2021-01-01",
    });
    expect(r.accrual).toBe(tl(125000));
  });

  it("henüz işe başlamamış: hakediş yok", () => {
    const r = accrualForPeriod({ period: "2026-10", contracts: [c("2026-12-01", 50000)], hireDate: "2026-12-01" });
    expect(r.accrual).toBe(0);
  });
});

describe("zam hesabı", () => {
  it("yüzde, tutar, sabit ve yuvarlama", () => {
    expect(applyRaise(tl(65000), { kind: "PERCENT", value: 20 })).toBe(tl(78000));
    expect(applyRaise(tl(65000), { kind: "PERCENT", value: 17, roundTo: tl(500) })).toBe(tl(76000)); // 76.050 → 76.000
    expect(applyRaise(tl(40000), { kind: "AMOUNT", value: tl(7500) })).toBe(tl(47500));
    expect(applyRaise(tl(40000), { kind: "SET", value: tl(50000) })).toBe(tl(50000));
    expect(raisePercent(tl(40000), tl(50000))).toBe(25);
  });
});
