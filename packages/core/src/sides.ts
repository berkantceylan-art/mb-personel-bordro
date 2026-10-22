import { type LegalParams, PARAMS_2026 } from "./legal-params";
import { roundKurus, type Kurus } from "./money";
import { grossToNet, splitContract, type PayContract } from "./payroll";

/**
 * Resmi / elden ayrımı.
 * - Resmi kısım: resmi brüt üzerinden hesaplanır; bordroya brüt olarak girer, personelin eline
 *   geçen net etkisi bordro motoruyla bulunur.
 * - Elden kısım: (toplam − resmi net) üzerinden, net olarak hesaplanır.
 */
export type PaySide = "OFFICIAL" | "CASH" | "BOTH";

export interface SideAmounts {
  officialGross: Kurus;
  officialNet: Kurus;
  cash: Kurus;
}

export interface SideContext {
  contract: PayContract;
  month: number;
  cumulativeTaxBaseBefore?: Kurus;
  params?: LegalParams;
}

function base(ctx: SideContext) {
  const params = ctx.params ?? PARAMS_2026;
  const split = splitContract(ctx.contract, ctx.month, ctx.cumulativeTaxBaseBefore ?? 0, params);
  return { params, split, gross: split.official.gross, net: split.official.net, cash: split.cashPart };
}

/** Fazla mesai: saatlik = aylık / 225 × oran; resmi brütten ve elden kısımdan ayrı ayrı */
export function overtimeSides(ctx: SideContext, minutes: number, rate: number): SideAmounts {
  const { params, gross, net, cash } = base(ctx);
  const factor = (minutes / 60) * rate / 225;
  // sigortasız (resmi brüt yok): yalnız elden kısım
  if (ctx.contract.insuranceType === "NONE" || gross <= 0) return { officialGross: 0, officialNet: 0, cash: roundKurus(cash * factor) };
  const otGross = roundKurus(gross * factor);
  const withOt = grossToNet({ gross: gross + otGross, month: ctx.month, cumulativeTaxBaseBefore: ctx.cumulativeTaxBaseBefore ?? 0, params });
  return { officialGross: otGross, officialNet: withOt.net - net, cash: roundKurus(cash * factor) };
}

/** Eksik gün / ücretsiz izin / rapor: günlük = aylık / 30; resmi tarafta SGK günü de düşer */
export function absenceSides(ctx: SideContext, days: number): SideAmounts {
  const { params, gross, net, cash } = base(ctx);
  const d = Math.min(30, Math.max(0, days));
  // sigortasız (resmi brüt yok): resmi tarafta kesinti olmaz, yalnız elden kısım düşer
  if (ctx.contract.insuranceType === "NONE" || gross <= 0) return { officialGross: 0, officialNet: 0, cash: roundKurus((cash * d) / 30) };
  const remaining = 30 - d;
  const reducedGross = roundKurus((gross * remaining) / 30);
  const reduced = remaining
    ? grossToNet({ gross: reducedGross, month: ctx.month, cumulativeTaxBaseBefore: ctx.cumulativeTaxBaseBefore ?? 0, days: remaining, params }).net
    : 0;
  return { officialGross: gross - reducedGross, officialNet: net - reduced, cash: roundKurus((cash * d) / 30) };
}

/** Seçilen tarafa göre cari hesaba yazılacak satırlar */
export function sideLines(a: SideAmounts, side: PaySide): Array<{ side: "OFFICIAL" | "CASH"; amount: Kurus; grossAmount: Kurus | null }> {
  const out: Array<{ side: "OFFICIAL" | "CASH"; amount: Kurus; grossAmount: Kurus | null }> = [];
  if ((side === "OFFICIAL" || side === "BOTH") && a.officialNet > 0) out.push({ side: "OFFICIAL", amount: a.officialNet, grossAmount: a.officialGross });
  if ((side === "CASH" || side === "BOTH") && a.cash > 0) out.push({ side: "CASH", amount: a.cash, grossAmount: null });
  return out;
}

/**
 * Resmi prim: personelin eline geçecek net prim için gereken ek resmi brüt (aynı ay, aynı kümülatif matrahla).
 * Elden prim için brüt yoktur, net tutar doğrudan elden kısma eklenir.
 */
export function officialBonusGross(ctx: SideContext, netBonus: Kurus): SideAmounts {
  const { params, gross, net } = base(ctx);
  if (netBonus <= 0) return { officialGross: 0, officialNet: 0, cash: 0 };
  const netWith = (g: Kurus) => grossToNet({ gross: gross + g, month: ctx.month, cumulativeTaxBaseBefore: ctx.cumulativeTaxBaseBefore ?? 0, params }).net - net;
  let lo = 0;
  let hi = Math.max(netBonus * 2, 100_00);
  while (netWith(hi) < netBonus) hi *= 2;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (netWith(mid) >= netBonus) hi = mid;
    else lo = mid;
  }
  return { officialGross: hi, officialNet: netWith(hi), cash: 0 };
}
