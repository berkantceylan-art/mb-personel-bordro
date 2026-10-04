import { type LegalParams, PARAMS_2026 } from "./legal-params";
import { roundKurus, type Kurus } from "./money";

/** Kümülatif matrah üzerinden artan oranlı gelir vergisi. */
export function incomeTax(
  cumulativeBefore: Kurus,
  base: Kurus,
  params: LegalParams = PARAMS_2026,
): Kurus {
  let remaining = base;
  let cursor = cumulativeBefore;
  let lower = 0;
  let tax = 0;
  for (const [upTo, rate] of params.incomeTaxBrackets) {
    if (remaining <= 0) break;
    if (cursor < upTo) {
      const room = upTo - Math.max(cursor, lower);
      const taxable = Math.min(room, remaining);
      tax += taxable * rate;
      remaining -= taxable;
      cursor += taxable;
    }
    lower = upTo;
  }
  return roundKurus(tax);
}

export interface GrossToNetInput {
  gross: Kurus;
  /** 1-12 */
  month: number;
  /** Bu aydan önceki yıl içi kümülatif gelir vergisi matrahı */
  cumulativeTaxBaseBefore: Kurus;
  /** Çalışılan / SGK'ya bildirilen gün (varsayılan 30) */
  days?: number;
  /** Otomatik katılım BES oranı; 0 = üye değil */
  besRate?: number;
  /** İşveren teşviki uygulanıyor mu */
  employerDiscount?: boolean;
  /** İşveren SGK oranı (verilirse employerDiscount yerine kullanılır; şirket teşvik ayarı) */
  employerRate?: number;
  params?: LegalParams;
}

export interface PayrollBreakdown {
  gross: Kurus;
  sgkBase: Kurus;
  sgkEmployee: Kurus;
  unemploymentEmployee: Kurus;
  taxBase: Kurus;
  incomeTaxGross: Kurus;
  incomeTaxExemption: Kurus;
  incomeTax: Kurus;
  stampTaxGross: Kurus;
  stampTaxExemption: Kurus;
  stampTax: Kurus;
  net: Kurus;
  bes: Kurus;
  /** BES sonrası, icra öncesi ele geçen */
  netAfterBes: Kurus;
  sgkEmployer: Kurus;
  unemploymentEmployer: Kurus;
  employerCost: Kurus;
  cumulativeTaxBaseAfter: Kurus;
}

/**
 * Brütten nete resmi bordro hesabı (asgari ücret GV ve DV istisnası dahil).
 */
export function grossToNet(input: GrossToNetInput): PayrollBreakdown {
  const p = input.params ?? PARAMS_2026;
  const days = input.days ?? 30;
  const dayRatio = days / 30;
  const { gross, month } = input;
  if (month < 1 || month > 12) throw new Error("Ay 1-12 arasında olmalı");

  const floor = roundKurus(p.sgkFloor * dayRatio);
  const ceiling = roundKurus(p.sgkCeiling * dayRatio);
  const sgkBase = Math.min(Math.max(gross, floor), ceiling);
  const sgkEmployee = roundKurus(sgkBase * p.sgkEmployeeRate);
  const unemploymentEmployee = roundKurus(sgkBase * p.unemploymentEmployeeRate);

  const taxBase = Math.max(0, gross - sgkEmployee - unemploymentEmployee);
  const incomeTaxGross = incomeTax(input.cumulativeTaxBaseBefore, taxBase, p);

  // Asgari ücret istisnası: asgari ücretin kendi kümülatif matrahı üzerinden
  const minGross = roundKurus(p.minWageGross * dayRatio);
  const minTaxBase = roundKurus(
    minGross * (1 - p.sgkEmployeeRate - p.unemploymentEmployeeRate),
  );
  const minMonthlyBase = roundKurus(
    p.minWageGross * (1 - p.sgkEmployeeRate - p.unemploymentEmployeeRate),
  );
  const minCumulativeBefore = minMonthlyBase * (month - 1);
  const incomeTaxExemption = Math.min(
    incomeTaxGross,
    incomeTax(minCumulativeBefore, minTaxBase, p),
  );
  const incomeTaxValue = incomeTaxGross - incomeTaxExemption;

  const stampTaxGross = roundKurus(gross * p.stampTaxRate);
  const stampTaxExemption = Math.min(
    stampTaxGross,
    roundKurus(minGross * p.stampTaxRate),
  );
  const stampTax = stampTaxGross - stampTaxExemption;

  const net =
    gross - sgkEmployee - unemploymentEmployee - incomeTaxValue - stampTax;
  const bes = roundKurus(sgkBase * (input.besRate ?? 0));

  const employerRate =
    input.employerRate ?? (input.employerDiscount ? p.sgkEmployerRateDiscounted : p.sgkEmployerRate);
  const sgkEmployer = roundKurus(sgkBase * employerRate);
  const unemploymentEmployer = roundKurus(sgkBase * p.unemploymentEmployerRate);

  return {
    gross,
    sgkBase,
    sgkEmployee,
    unemploymentEmployee,
    taxBase,
    incomeTaxGross,
    incomeTaxExemption,
    incomeTax: incomeTaxValue,
    stampTaxGross,
    stampTaxExemption,
    stampTax,
    net,
    bes,
    netAfterBes: net - bes,
    sgkEmployer,
    unemploymentEmployer,
    employerCost: gross + sgkEmployer + unemploymentEmployer,
    cumulativeTaxBaseAfter: input.cumulativeTaxBaseBefore + taxBase,
  };
}

export interface NetToGrossInput extends Omit<GrossToNetInput, "gross"> {
  targetNet: Kurus;
}

/**
 * Netten brüte: hedef nete ulaşan en küçük brütü ikili arama ile bulur.
 * Kümülatif matrah her ay değiştiği için "net sabit" sözleşmelerde her ay
 * yeniden çağrılmalıdır.
 */
export function netToGross(input: NetToGrossInput): PayrollBreakdown {
  const { targetNet, ...rest } = input;
  let lo = 0;
  let hi = Math.max(targetNet * 3, 100_000_00);
  while (grossToNet({ ...rest, gross: hi }).net < targetNet) hi *= 2;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (grossToNet({ ...rest, gross: mid }).net >= targetNet) hi = mid;
    else lo = mid;
  }
  return grossToNet({ ...rest, gross: hi });
}

/* ------------------------------------------------------------------ */
/* Sözleşme: toplam ücret = resmi net + elden                          */
/* ------------------------------------------------------------------ */

export type InsuranceType = "MIN_WAGE" | "FIXED_NET";

export interface PayContract {
  /** Personelle anlaşılan aylık toplam net ücret */
  totalNet: Kurus;
  insuranceType: InsuranceType;
  /** insuranceType = FIXED_NET ise bankaya yatacak resmi net */
  fixedOfficialNet?: Kurus;
  besRate?: number;
}

export interface OfficialSplit {
  official: PayrollBreakdown;
  /** Toplam ücretten resmi net çıktıktan sonra elden verilecek kısım */
  cashPart: Kurus;
}

export function splitContract(
  contract: PayContract,
  month: number,
  cumulativeTaxBaseBefore: Kurus,
  params: LegalParams = PARAMS_2026,
): OfficialSplit {
  const besRate = contract.besRate ?? 0;
  const official =
    contract.insuranceType === "MIN_WAGE"
      ? grossToNet({
          gross: params.minWageGross,
          month,
          cumulativeTaxBaseBefore,
          besRate,
          params,
        })
      : netToGross({
          targetNet: contract.fixedOfficialNet ?? 0,
          month,
          cumulativeTaxBaseBefore,
          besRate,
          params,
        });
  return { official, cashPart: Math.max(0, contract.totalNet - official.net) };
}

/** Hakediş: günlük ücret = aylık / 30; eksik gün düşülür. */
export function monthlyAccrual(
  monthlyTotal: Kurus,
  missingDays: number,
  extras: Kurus = 0,
): { dailyWage: Kurus; missingAmount: Kurus; accrual: Kurus } {
  const dailyWage = monthlyTotal / 30;
  const missingAmount = roundKurus(dailyWage * missingDays);
  return {
    dailyWage: roundKurus(dailyWage),
    missingAmount,
    accrual: monthlyTotal - missingAmount + extras,
  };
}
