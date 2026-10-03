import { tl, type Kurus } from "./money";

/**
 * Yıla bağlı yasal parametreler. Uygulamada veritabanındaki `legal_params`
 * tablosundan okunur; bu sabitler varsayılan ve test değeridir.
 */
export interface LegalParams {
  year: number;
  /** Aylık brüt asgari ücret */
  minWageGross: Kurus;
  /** SGK prime esas kazanç alt / üst sınırı (aylık, 30 gün) */
  sgkFloor: Kurus;
  sgkCeiling: Kurus;
  sgkEmployeeRate: number;
  unemploymentEmployeeRate: number;
  sgkEmployerRate: number;
  /** 5 puanlık hazine teşviki uygulanmış işveren oranı */
  sgkEmployerRateDiscounted: number;
  unemploymentEmployerRate: number;
  stampTaxRate: number;
  /** Ücret gelirleri için kümülatif gelir vergisi dilimleri: [üst sınır, oran] */
  incomeTaxBrackets: Array<[upTo: Kurus, rate: number]>;
  /** Otomatik katılım BES varsayılan kesinti oranı */
  besDefaultRate: number;
}

export const PARAMS_2026: LegalParams = {
  year: 2026,
  minWageGross: tl(33030),
  sgkFloor: tl(33030),
  sgkCeiling: tl(297270),
  sgkEmployeeRate: 0.14,
  unemploymentEmployeeRate: 0.01,
  sgkEmployerRate: 0.2175,
  sgkEmployerRateDiscounted: 0.1975,
  unemploymentEmployerRate: 0.02,
  stampTaxRate: 0.00759,
  incomeTaxBrackets: [
    [tl(190000), 0.15],
    [tl(400000), 0.2],
    [tl(1500000), 0.27],
    [tl(5300000), 0.35],
    [Number.POSITIVE_INFINITY, 0.4],
  ],
  besDefaultRate: 0.03,
};

export const PARAMS_BY_YEAR: Record<number, LegalParams> = {
  2026: PARAMS_2026,
};

export function paramsFor(year: number): LegalParams {
  const p = PARAMS_BY_YEAR[year];
  if (!p) throw new Error(`${year} yılı için yasal parametre tanımlı değil`);
  return p;
}
