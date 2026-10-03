/**
 * Para birimi yardımcıları. Tüm hesaplar kuruş (tam sayı) üzerinden yapılır;
 * kayan nokta hatası bordroda kabul edilemez.
 */
export type Kurus = number;

export const tl = (lira: number): Kurus => Math.round(lira * 100);
export const toLira = (k: Kurus): number => k / 100;

/** Kuruşa yuvarlar (yarım kuruş yukarı). */
export const roundKurus = (k: number): Kurus => Math.round(k);

export const sum = (xs: Kurus[]): Kurus => xs.reduce((a, b) => a + b, 0);

const fmt = new Intl.NumberFormat("tr-TR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** 1234567 → "₺12.345,67" */
export const formatTL = (k: Kurus): string =>
  (k < 0 ? "−₺" : "₺") + fmt.format(Math.abs(k) / 100);

/** "12.345,67" veya "12345.67" → kuruş */
export const parseTL = (s: string): Kurus => {
  const clean = s.replace(/[₺\s]/g, "");
  const normalized = clean.includes(",")
    ? clean.replace(/\./g, "").replace(",", ".")
    : clean;
  const n = Number(normalized);
  if (!Number.isFinite(n)) throw new Error(`Geçersiz tutar: ${s}`);
  return tl(n);
};
