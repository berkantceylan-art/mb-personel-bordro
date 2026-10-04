import { describe, expect, it } from "vitest";
import { parseTL } from "../src/money";

describe("parseTL — Türkçe tutar yazımı", () => {
  const ok: Array<[string, number]> = [
    ["5.000", 500000],
    ["12.500", 1250000],
    ["1.250.000", 125000000],
    ["12.500,50", 1250050],
    ["12500,5", 1250050],
    ["1234,56", 123456],
    ["1234.56", 123456],
    ["1234.5", 123450],
    ["1,234.56", 123456],
    ["1,234,567", 123456700],
    ["5000", 500000],
    ["₺ 5.000", 500000],
    ["5.000 TL", 500000],
    ["0,99", 99],
    ["28075,50", 2807550],
  ];
  for (const [input, kurus] of ok) it(`"${input}" → ${kurus}`, () => expect(parseTL(input)).toBe(kurus));

  for (const bad of ["", "abc", "1,234", "12,345", "1.2.3,4,5", "1.234,567", "--5"]) {
    it(`"${bad}" reddedilir`, () => expect(() => parseTL(bad)).toThrow());
  }
});
