/**
 * Şirkete özel mevzuat yorumları. Mali müşavirin görüşüne göre Yönetim > Mevzuat
 * ayarlarından değiştirilir; varsayılanlar yaygın uygulamadır.
 */
export type OvertimeRounding = "HALF_HOUR" | "EXACT";
export type OvertimeBasis = "WEEKLY" | "DAILY";

export interface CompanySettings {
  /** Resmi tatilde çalışılan her saat için maaşa EK ödenecek saat ücreti katı (İş K. 47: 1 = bir günlük ücret) */
  holidayExtraRate: number;
  /** Fazla mesai süresi yuvarlama: HALF_HOUR = 30 dk altı yarım saat, üstü bir saat (Yönetmelik) */
  overtimeRounding: OvertimeRounding;
  /** WEEKLY = haftalık 45 saati aşan süre (İş K. 41); DAILY = vardiya süresini aşan süre */
  overtimeBasis: OvertimeBasis;
  /** SGK işveren payı teşvik indirimi (puan): imalat 5, diğer 2, yok 0 */
  sgkIncentivePoints: number;
  /** İcra payı (1/4) nafaka düşüldükten sonra kalan netten mi hesaplansın (İİK 83) */
  garnishmentAfterAlimony: boolean;
  /** İcra payı BES kesintisi düşüldükten sonraki netten mi hesaplansın */
  garnishmentAfterBes: boolean;
}

export const DEFAULT_SETTINGS: CompanySettings = {
  holidayExtraRate: 1,
  overtimeRounding: "HALF_HOUR",
  overtimeBasis: "WEEKLY",
  sgkIncentivePoints: 5,
  garnishmentAfterAlimony: true,
  garnishmentAfterBes: false,
};

/** Yasal sınırlar (uyarı için) */
export const LIMITS = {
  weeklyMinutes: 45 * 60,
  dailyMaxWorkMinutes: 11 * 60,
  yearlyOvertimeMinutes: 270 * 60,
  nightWorkMaxMinutes: 7.5 * 60,
} as const;

/** Fazla mesai süresini yuvarlar. HALF_HOUR: tam saatler korunur, artan 1–30 dk → 30, 31–59 dk → 60. */
export function roundOvertime(minutes: number, mode: OvertimeRounding): number {
  if (minutes <= 0) return 0;
  if (mode === "EXACT") return Math.round(minutes);
  const full = Math.floor(minutes / 60) * 60;
  const rest = minutes - full;
  if (rest <= 0) return full;
  return full + (rest <= 30 ? 30 : 60);
}

/** SGK işveren payı (teşvik dahil) */
export function employerRateFor(baseRate: number, discount: boolean, incentivePoints: number): number {
  return discount ? Math.max(0, Math.round((baseRate - incentivePoints / 100) * 1e6) / 1e6) : baseRate;
}

/** Veritabanı satırını (snake_case) ayara çevirir; eksik alanlar varsayılan */
export function settingsFromRow(row: Record<string, unknown> | null | undefined): CompanySettings {
  if (!row) return { ...DEFAULT_SETTINGS };
  const num = (v: unknown, d: number) => (v === null || v === undefined || Number.isNaN(Number(v)) ? d : Number(v));
  const bool = (v: unknown, d: boolean) => (typeof v === "boolean" ? v : d);
  return {
    holidayExtraRate: num(row.holiday_extra_rate, DEFAULT_SETTINGS.holidayExtraRate),
    overtimeRounding: row.overtime_rounding === "EXACT" ? "EXACT" : "HALF_HOUR",
    overtimeBasis: row.overtime_basis === "DAILY" ? "DAILY" : "WEEKLY",
    sgkIncentivePoints: num(row.sgk_incentive_points, DEFAULT_SETTINGS.sgkIncentivePoints),
    garnishmentAfterAlimony: bool(row.garnishment_after_alimony, DEFAULT_SETTINGS.garnishmentAfterAlimony),
    garnishmentAfterBes: bool(row.garnishment_after_bes, DEFAULT_SETTINGS.garnishmentAfterBes),
  };
}
