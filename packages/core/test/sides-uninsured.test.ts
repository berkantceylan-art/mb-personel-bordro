import { describe, expect, it } from "vitest";
import { absenceSides, overtimeSides, sideLines } from "../src";

describe("sigortasız personel — resmi taraf yok", () => {
  const contract = { totalNet: 2_500_000, insuranceType: "NONE" as const };

  it("3 gün rapor: yalnız elden 2.500 kesilir, resmi kesinti 0", () => {
    const a = absenceSides({ contract, month: 10 }, 3);
    expect(a).toEqual({ officialGross: 0, officialNet: 0, cash: 250_000 });
    expect(sideLines(a, "BOTH")).toEqual([{ side: "CASH", amount: 250_000, grossAmount: null }]);
  });

  it.each([1, 10, 29, 30])("%i gün eksik: resmi kesinti 0", (d) => {
    const a = absenceSides({ contract, month: 10 }, d);
    expect(a.officialNet).toBe(0);
    expect(a.officialGross).toBe(0);
  });

  it("fazla mesai: resmi net negatif olmaz", () => {
    const a = overtimeSides({ contract, month: 10 }, 600, 1.5);
    expect(a.officialNet).toBe(0);
    expect(a.officialGross).toBe(0);
    expect(a.cash).toBeGreaterThan(0);
  });
});
