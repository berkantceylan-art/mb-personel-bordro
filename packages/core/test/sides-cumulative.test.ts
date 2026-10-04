import { describe, expect, it } from "vitest";
import { grossToNet, overtimeSides, runPayroll, splitContract } from "../src";

describe("fazla mesai resmi neti — kümülatif matrah", () => {
  const contract = { totalNet: 4_000_000, insuranceType: "MIN_WAGE" as const };
  // Ocak–Eylül asgari ücretle çalışılmış kümülatif matrah
  const base = splitContract(contract, 1, 0).official.gross;
  const cum = grossToNet({ gross: base, month: 1, cumulativeTaxBaseBefore: 0 }).taxBase * 9;

  it("bordrodaki net artışla aynı olmalı (Ekim, 10 saat × 1,5)", () => {
    const a = overtimeSides({ contract, month: 10, cumulativeTaxBaseBefore: cum }, 600, 1.5);
    const withOt = runPayroll({ contract, month: 10, cumulativeTaxBaseBefore: cum, officialOvertimeGross: a.officialGross });
    const without = runPayroll({ contract, month: 10, cumulativeTaxBaseBefore: cum });
    expect(a.officialNet).toBe(withOt.breakdown.net - without.breakdown.net);
  });

  it("kümülatif 0 varsaymak neti şişirir (eski hata)", () => {
    const wrong = overtimeSides({ contract, month: 10 }, 600, 1.5);
    const right = overtimeSides({ contract, month: 10, cumulativeTaxBaseBefore: cum }, 600, 1.5);
    expect(wrong.officialNet).toBeGreaterThan(right.officialNet);
  });
});
