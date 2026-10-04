import { allocateGarnishments, type GarnishmentFile, type GarnishmentLine } from "./garnishment";
import { type LegalParams, PARAMS_2026 } from "./legal-params";
import { employerRateFor } from "./settings";
import { roundKurus, type Kurus } from "./money";
import { grossToNet, splitContract, type PayContract, type PayrollBreakdown } from "./payroll";

/**
 * Aylık resmi bordro hesabı (bir personel).
 * Resmi brüt = (sözleşmenin resmi brütü × bordro günü / 30) + resmi fazla mesai brütü + resmi prim brütü
 */
export interface PayrollInput {
  contract: PayContract;
  month: number;
  cumulativeTaxBaseBefore: Kurus;
  /** Resmi tarafa yansıtılan eksik gün (SGK günü bu kadar düşer) */
  officialMissingDays?: number;
  /** Ay içinde işe giriş/çıkış nedeniyle bordro günü (varsayılan 30) */
  employedDays?: number;
  officialOvertimeGross?: Kurus;
  officialBonusGross?: Kurus;
  garnishments?: GarnishmentFile[];
  employerDiscount?: boolean;
  /** SGK işveren payı teşvik puanı (şirket ayarı; verilmezse parametredeki indirimli oran) */
  sgkIncentivePoints?: number;
  /** Ay içinde ücret değiştiyse sözleşme dilimleri: resmi brüt güne bölünür */
  contractSegments?: Array<{ contract: PayContract; days: number }>;
  /** İcra 1/4'ü nafaka sonrası netten */
  garnishmentAfterAlimony?: boolean;
  /** İcra 1/4'ü BES sonrası netten */
  garnishmentAfterBes?: boolean;
  params?: LegalParams;
}

export interface PayrollResult {
  days: number;
  baseGross: Kurus;
  dayGross: Kurus;
  overtimeGross: Kurus;
  bonusGross: Kurus;
  breakdown: PayrollBreakdown;
  garnishments: GarnishmentLine[];
  garnishmentTotal: Kurus;
  /** Bankaya yatacak resmi net (BES ve icra sonrası) */
  netToBank: Kurus;
  /** Anlaşılan toplam − resmi net (tam ay) */
  cashPart: Kurus;
}

export function runPayroll(i: PayrollInput): PayrollResult {
  const params = i.params ?? PARAMS_2026;
  const split = splitContract(i.contract, i.month, i.cumulativeTaxBaseBefore, params);
  const segs = (i.contractSegments ?? []).filter((x) => x.days > 0);
  const segDays = segs.reduce((a, x) => a + x.days, 0);
  // Ay ortası ücret değişikliği: aylık resmi brüt, dilimlerin gün ağırlıklı ortalaması
  const baseGross =
    segs.length > 1 && segDays > 0
      ? roundKurus(segs.reduce((a, x) => a + splitContract(x.contract, i.month, i.cumulativeTaxBaseBefore, params).official.gross * x.days, 0) / segDays)
      : split.official.gross;
  const days = Math.max(0, Math.min(30, (i.employedDays ?? 30) - (i.officialMissingDays ?? 0)));
  const dayGross = roundKurus((baseGross * days) / 30);
  const overtimeGross = i.officialOvertimeGross ?? 0;
  const bonusGross = i.officialBonusGross ?? 0;
  const gross = dayGross + overtimeGross + bonusGross;

  const breakdown =
    days > 0 || gross > 0
      ? grossToNet({
          gross,
          month: i.month,
          cumulativeTaxBaseBefore: i.cumulativeTaxBaseBefore,
          days: Math.max(days, 1),
          besRate: i.contract.besRate ?? 0,
          employerDiscount: i.employerDiscount ?? true,
          employerRate:
            i.sgkIncentivePoints === undefined ? undefined : employerRateFor(params.sgkEmployerRate, i.employerDiscount ?? true, i.sgkIncentivePoints),
          params,
        })
      : grossToNet({ gross: 0, month: i.month, cumulativeTaxBaseBefore: i.cumulativeTaxBaseBefore, days: 0, params });

  // İcra/nafaka en fazla BES sonrası nete kadar kesilebilir
  const available = Math.max(0, breakdown.net - breakdown.bes);
  const g = allocateGarnishments(i.garnishmentAfterBes ? available : breakdown.net, i.garnishments ?? [], 0.25, {
    afterAlimony: i.garnishmentAfterAlimony,
  });
  if (g.total > available) {
    let over = g.total - available;
    for (let k = g.lines.length - 1; k >= 0 && over > 0; k--) {
      const cut = Math.min(g.lines[k]!.amount, over);
      g.lines[k]!.amount -= cut;
      over -= cut;
    }
    g.lines = g.lines.filter((l) => l.amount > 0);
    g.total = g.lines.reduce((a, l) => a + l.amount, 0);
  }
  return {
    days,
    baseGross,
    dayGross,
    overtimeGross,
    bonusGross,
    breakdown,
    garnishments: g.lines,
    garnishmentTotal: g.total,
    netToBank: Math.max(0, breakdown.net - breakdown.bes - g.total),
    cashPart: split.cashPart,
  };
}

/**
 * Dönem sonu dağılımı: kalan alacağın ne kadarı bankaya, ne kadarı elden.
 * Banka tarafı = bordro neti (BES/icra sonrası) − dönem içinde bankadan ödenenler.
 */
export function settlement(balance: Kurus, netToBank: Kurus, paidBank: Kurus): { bank: Kurus; cash: Kurus } {
  const bank = Math.max(0, Math.min(balance, netToBank - paidBank));
  return { bank, cash: Math.max(0, balance - bank) };
}
