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
  /** GVK md. 31 aylık engellilik indirimi [1. derece (%80+), 2. derece (%60-79), 3. derece (%40-59)] */
  disabilityDeduction?: [Kurus, Kurus, Kurus];
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
  disabilityDeduction: [tl(12000), tl(7000), tl(3000)],
};

/** Engellilik oranı (%) → vergi indirimi derecesi: 1 (%80+), 2 (%60-79), 3 (%40-59), 0 (indirim yok) */
export function disabilityTaxDegree(percent: number | null | undefined): 0 | 1 | 2 | 3 {
  const p = Number(percent ?? 0);
  return p >= 80 ? 1 : p >= 60 ? 2 : p >= 40 ? 3 : 0;
}

/** Yılın aylık engellilik indirimi (parametrede yoksa 2026 tutarları) */
export function disabilityDeductionFor(params: LegalParams, degree: 0 | 1 | 2 | 3 | undefined): Kurus {
  if (!degree) return 0;
  const t = params.disabilityDeduction ?? PARAMS_2026.disabilityDeduction!;
  return t[degree - 1] ?? 0;
}

export const PARAMS_BY_YEAR: Record<number, LegalParams> = {
  2026: PARAMS_2026,
};

/**
 * Koddaki tablodan yılın parametresi. Yıl tanımlı değilse en yakın önceki yıl döner (hata vermez);
 * uyarı göstermek ya da veritabanı değerlerini katmak için `resolveParams` / web'deki `legalParams` kullanın.
 */
export function paramsFor(year: number): LegalParams {
  return resolveParams(year).params;
}

export interface ResolvedParams {
  params: LegalParams;
  /** İstenen yılın kendi değerleri mi (false = en yakın önceki yıl kullanıldı) */
  exact: boolean;
  /** Fiilen kullanılan yıl */
  usedYear: number;
}

/**
 * Yıla göre parametre: önce `extra` (veritabanındaki legal_params), sonra koddaki tablo.
 * O yıl tanımlı değilse en yakın önceki yıl kullanılır ve `exact: false` döner (ekranda uyarı için).
 * Hiç önceki yıl yoksa en eski tanımlı yıl.
 */
export function resolveParams(year: number, extra: Record<number, LegalParams> = {}): ResolvedParams {
  const all: Record<number, LegalParams> = { ...PARAMS_BY_YEAR, ...extra };
  if (all[year]) return { params: all[year]!, exact: true, usedYear: year };
  const years = Object.keys(all).map(Number).sort((a, b) => a - b);
  const prior = years.filter((y) => y < year).at(-1) ?? years[0]!;
  return { params: all[prior]!, exact: false, usedYear: prior };
}

/**
 * Veritabanı `legal_params.data` (jsonb) → LegalParams. Tutarlar kuruş; son dilimin üst sınırı null = sınırsız.
 * Eksik ya da hatalı kayıtta null döner (kod tablosu kullanılır).
 */
export function paramsFromJson(year: number, data: unknown): LegalParams | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  const num = (k: string) => (typeof d[k] === "number" && Number.isFinite(d[k]) ? (d[k] as number) : NaN);
  const brackets = Array.isArray(d.incomeTaxBrackets)
    ? (d.incomeTaxBrackets as unknown[]).map((b) => {
        const [up, rate] = Array.isArray(b) ? b : [];
        return [up === null || up === undefined ? Number.POSITIVE_INFINITY : Number(up), Number(rate)] as [number, number];
      })
    : [];
  const p: LegalParams = {
    year,
    minWageGross: num("minWageGross"),
    sgkFloor: num("sgkFloor"),
    sgkCeiling: num("sgkCeiling"),
    sgkEmployeeRate: num("sgkEmployeeRate"),
    unemploymentEmployeeRate: num("unemploymentEmployeeRate"),
    sgkEmployerRate: num("sgkEmployerRate"),
    sgkEmployerRateDiscounted: num("sgkEmployerRateDiscounted"),
    unemploymentEmployerRate: num("unemploymentEmployerRate"),
    stampTaxRate: num("stampTaxRate"),
    incomeTaxBrackets: brackets,
    besDefaultRate: Number.isFinite(num("besDefaultRate")) ? num("besDefaultRate") : 0.03,
    ...(Array.isArray(d.disabilityDeduction) && (d.disabilityDeduction as unknown[]).length === 3 && (d.disabilityDeduction as unknown[]).every((x) => typeof x === "number" && x >= 0)
      ? { disabilityDeduction: d.disabilityDeduction as [number, number, number] }
      : {}),
  };
  const ok =
    [p.minWageGross, p.sgkFloor, p.sgkCeiling, p.sgkEmployeeRate, p.unemploymentEmployeeRate, p.sgkEmployerRate, p.sgkEmployerRateDiscounted, p.unemploymentEmployerRate, p.stampTaxRate].every(
      (v) => Number.isFinite(v) && v >= 0,
    ) &&
    p.minWageGross > 0 &&
    brackets.length > 0 &&
    brackets.every(([u, r]) => u > 0 && r >= 0 && r < 1) &&
    brackets.at(-1)![0] === Number.POSITIVE_INFINITY;
  return ok ? p : null;
}
