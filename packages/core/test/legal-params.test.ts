import { describe, expect, it } from "vitest";
import { PARAMS_2026, paramsFor, paramsFromJson, resolveParams, runPayroll, tl } from "../src";

describe("yıl bazlı yasal parametreler", () => {
  it("tanımlı yıl tam eşleşir", () => {
    expect(resolveParams(2026)).toMatchObject({ exact: true, usedYear: 2026 });
  });
  it("tanımsız yılda en yakın önceki yıl kullanılır ve uyarı bayrağı döner", () => {
    const r = resolveParams(2027);
    expect(r.exact).toBe(false);
    expect(r.usedYear).toBe(2026);
    expect(paramsFor(2027)).toBe(PARAMS_2026);
  });
  it("veritabanı kaydı yeni yılı ve tutarları belirler", () => {
    const data = { ...PARAMS_2026, minWageGross: tl(40000), sgkFloor: tl(40000), incomeTaxBrackets: [[tl(200000), 0.15], [null, 0.4]] };
    const p = paramsFromJson(2027, JSON.parse(JSON.stringify(data)));
    expect(p).not.toBeNull();
    const r = resolveParams(2027, { 2027: p! });
    expect(r).toMatchObject({ exact: true, usedYear: 2027 });
    expect(r.params.incomeTaxBrackets.at(-1)![0]).toBe(Number.POSITIVE_INFINITY);
    const pay = runPayroll({ contract: { totalNet: tl(50000), insuranceType: "MIN_WAGE" }, month: 1, cumulativeTaxBaseBefore: 0, params: r.params });
    expect(pay.breakdown.gross).toBe(tl(40000));
  });
  it("eksik ya da bozuk kayıt reddedilir", () => {
    expect(paramsFromJson(2027, { minWageGross: 1 })).toBeNull();
    expect(paramsFromJson(2027, null)).toBeNull();
    expect(paramsFromJson(2027, { ...PARAMS_2026, incomeTaxBrackets: [[tl(100), 0.15]] })).toBeNull();
  });
});
