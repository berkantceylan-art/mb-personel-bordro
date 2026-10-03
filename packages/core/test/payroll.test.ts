import { describe, expect, it } from "vitest";
import {
  PARAMS_2026,
  allocateGarnishments,
  grossToNet,
  incomeTax,
  monthlyAccrual,
  netToGross,
  splitContract,
  tl,
} from "../src";

describe("gelir vergisi dilimleri 2026", () => {
  it("dilim geçişini kümülatif hesaplar", () => {
    // 190.000 × %15 + 10.000 × %20
    expect(incomeTax(0, tl(200000))).toBe(tl(30500));
    // 180.000 sonrası 20.000 matrah: 10.000 × %15 + 10.000 × %20
    expect(incomeTax(tl(180000), tl(20000))).toBe(tl(3500));
  });
});

describe("brütten nete", () => {
  it("asgari ücret netini verir (Ocak)", () => {
    const r = grossToNet({ gross: PARAMS_2026.minWageGross, month: 1, cumulativeTaxBaseBefore: 0 });
    expect(r.sgkEmployee).toBe(tl(4624.2));
    expect(r.unemploymentEmployee).toBe(tl(330.3));
    expect(r.incomeTax).toBe(0);
    expect(r.stampTax).toBe(0);
    expect(r.net).toBe(tl(28075.5));
  });

  it("asgari ücret net, yıl içinde vergi dilimi değişse de sabit kalır (Ağustos)", () => {
    const cum = tl(28075.5) * 7;
    const r = grossToNet({ gross: PARAMS_2026.minWageGross, month: 8, cumulativeTaxBaseBefore: cum });
    expect(r.net).toBe(tl(28075.5));
  });

  it("BES otomatik katılım %3 prime esas kazançtan kesilir", () => {
    const r = grossToNet({
      gross: PARAMS_2026.minWageGross,
      month: 1,
      cumulativeTaxBaseBefore: 0,
      besRate: 0.03,
    });
    expect(r.bes).toBe(tl(990.9));
    expect(r.netAfterBes).toBe(tl(27084.6));
  });

  it("SGK tavanı uygulanır", () => {
    const r = grossToNet({ gross: tl(400000), month: 1, cumulativeTaxBaseBefore: 0 });
    expect(r.sgkBase).toBe(PARAMS_2026.sgkCeiling);
  });
});

describe("netten brüte", () => {
  it("30.000 net için brüt ≈ 35.721,95 (Ocak)", () => {
    const r = netToGross({ targetNet: tl(30000), month: 1, cumulativeTaxBaseBefore: 0 });
    expect(r.net).toBeGreaterThanOrEqual(tl(30000));
    expect(r.net - tl(30000)).toBeLessThanOrEqual(1);
    expect(Math.abs(r.gross - tl(35721.95))).toBeLessThanOrEqual(2);
  });

  it("dilim yükselince aynı net için brüt artar", () => {
    const jan = netToGross({ targetNet: tl(30000), month: 1, cumulativeTaxBaseBefore: 0 });
    const aug = netToGross({
      targetNet: tl(30000),
      month: 8,
      cumulativeTaxBaseBefore: jan.taxBase * 7,
    });
    expect(aug.gross).toBeGreaterThan(jan.gross);
    expect(aug.net).toBeGreaterThanOrEqual(tl(30000));
  });
});

describe("sözleşme bölme: toplam = resmi net + elden", () => {
  it("100.000 toplam, asgari ücretli → 71.924,50 elden", () => {
    const s = splitContract({ totalNet: tl(100000), insuranceType: "MIN_WAGE" }, 1, 0);
    expect(s.official.net).toBe(tl(28075.5));
    expect(s.cashPart).toBe(tl(71924.5));
  });

  it("150.000 toplam, 30.000 net sigortalı → 120.000 elden", () => {
    const s = splitContract(
      { totalNet: tl(150000), insuranceType: "FIXED_NET", fixedOfficialNet: tl(30000) },
      1,
      0,
    );
    expect(s.cashPart).toBeGreaterThanOrEqual(tl(119999.99));
    expect(s.cashPart).toBeLessThanOrEqual(tl(120000));
  });
});

describe("hakediş", () => {
  it("günlük ücret × eksik gün düşülür", () => {
    const r = monthlyAccrual(tl(150000), 2);
    expect(r.dailyWage).toBe(tl(5000));
    expect(r.missingAmount).toBe(tl(10000));
    expect(r.accrual).toBe(tl(140000));
  });
});

describe("icra ve nafaka", () => {
  it("nafaka önce tam, icra 1/4 sınırında tebliğ sırasıyla", () => {
    const net = tl(28075.5);
    const r = allocateGarnishments(net, [
      { id: "icra-2", kind: "ENFORCEMENT", servedAt: "2026-03-01", remainingDebt: tl(50000), active: true },
      { id: "icra-1", kind: "ENFORCEMENT", servedAt: "2025-11-01", remainingDebt: tl(3000), active: true },
      { id: "nafaka", kind: "ALIMONY", servedAt: "2026-05-01", monthlyAmount: tl(5000), active: true },
    ]);
    expect(r.lines.map((l) => l.fileId)).toEqual(["nafaka", "icra-1", "icra-2"]);
    expect(r.lines[0]!.amount).toBe(tl(5000));
    expect(r.lines[1]!.amount).toBe(tl(3000));
    // 1/4 = 7.018,88 → ilk dosya 3.000 aldı, ikinciye 4.018,88
    expect(r.lines[2]!.amount).toBe(tl(4018.88));
  });
});
