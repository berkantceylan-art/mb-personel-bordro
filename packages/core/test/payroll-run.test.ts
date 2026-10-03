import { describe, expect, it } from "vitest";
import { absenceSides, overtimeSides, runPayroll, settlement, sideLines, tl } from "../src";

const minWage100k = { totalNet: tl(100000), insuranceType: "MIN_WAGE" as const };
const fixed30k = { totalNet: tl(150000), insuranceType: "FIXED_NET" as const, fixedOfficialNet: tl(30000) };

describe("resmi / elden ayrımı", () => {
  it("fazla mesai: resmi brütten ve elden kısımdan ayrı", () => {
    // 2 saat ×1,5: resmi 33.030/225×3 = 440,40 brüt ; elden 71.924,50/225×3 = 959,00
    const a = overtimeSides({ contract: minWage100k, month: 1 }, 120, 1.5);
    expect(a.officialGross).toBe(tl(440.4));
    expect(a.cash).toBe(tl(958.99));
    expect(a.officialNet).toBeGreaterThan(tl(300));
    expect(a.officialNet).toBeLessThan(a.officialGross);
  });

  it("eksik gün: resmi tarafta brüt ve net düşer, elden günlük", () => {
    const a = absenceSides({ contract: minWage100k, month: 1 }, 3);
    expect(a.officialGross).toBe(tl(3303));
    expect(a.officialNet).toBe(tl(2807.55)); // 28.075,50 × 3/30
    expect(a.cash).toBe(tl(7192.45));
  });

  it("seçime göre satırlar", () => {
    const a = { officialGross: 100, officialNet: 80, cash: 50 };
    expect(sideLines(a, "BOTH").map((l) => l.side)).toEqual(["OFFICIAL", "CASH"]);
    expect(sideLines(a, "CASH")).toEqual([{ side: "CASH", amount: 50, grossAmount: null }]);
    expect(sideLines(a, "OFFICIAL")[0]!.grossAmount).toBe(100);
  });
});

describe("bordro", () => {
  it("asgari ücretli, BES ve icra", () => {
    const r = runPayroll({
      contract: { ...minWage100k, besRate: 0.03 },
      month: 10,
      cumulativeTaxBaseBefore: tl(28075.5) * 9,
      garnishments: [{ id: "i1", kind: "ENFORCEMENT", servedAt: "2026-01-01", remainingDebt: tl(50000), active: true }],
    });
    expect(r.breakdown.net).toBe(tl(28075.5));
    expect(r.breakdown.bes).toBe(tl(990.9));
    expect(r.garnishmentTotal).toBe(tl(7018.88));
    expect(r.netToBank).toBe(tl(20065.72));
    expect(r.cashPart).toBe(tl(71924.5));
  });

  it("eksik gün ve resmi fazla mesai brüte yansır", () => {
    const r = runPayroll({ contract: minWage100k, month: 1, cumulativeTaxBaseBefore: 0, officialMissingDays: 2, officialOvertimeGross: tl(440.4) });
    expect(r.days).toBe(28);
    expect(r.dayGross).toBe(tl(30828));
    expect(r.breakdown.gross).toBe(tl(31268.4));
  });

  it("belirli net sigortalı: resmi net korunur", () => {
    const r = runPayroll({ contract: fixed30k, month: 1, cumulativeTaxBaseBefore: 0 });
    expect(r.breakdown.net).toBeGreaterThanOrEqual(tl(30000));
    expect(r.breakdown.net - tl(30000)).toBeLessThanOrEqual(1);
  });

  it("dönem sonu banka / elden dağılımı", () => {
    // kalan 6.924,50; bordro neti 20.065,72; bankadan 15.000 avans + 5.065,72 maaş ödenmiş
    expect(settlement(tl(6924.5), tl(20065.72), tl(20065.72))).toEqual({ bank: 0, cash: tl(6924.5) });
    // henüz banka maaşı ödenmemiş: kalan 61.990,22, banka avansı 15.000
    expect(settlement(tl(61990.22), tl(20065.72), tl(15000))).toEqual({ bank: tl(5065.72), cash: tl(56924.5) });
  });
});
