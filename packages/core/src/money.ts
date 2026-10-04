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

/**
 * Kullanıcının yazdığı tutarı kuruşa çevirir. Türkçe yazımı esas alır:
 *   "5.000" → 5.000 TL · "12.500,50" → 12.500,50 TL · "1234,5" → 1.234,50 TL · "1234.56" → 1.234,56 TL
 * İki ayraç birlikte varsa sondaki ondalıktır ("1,234.56" de okunur).
 * Tek nokta + tam 3 hane binlik sayılır ("5.000"); 3'ten fazla ondalık hane belirsiz sayılıp reddedilir.
 */
export const parseTL = (s: string): Kurus => {
  const clean = String(s).replace(/₺|TL|\s/gi, "");
  const fail = () => {
    throw new Error(`Geçersiz tutar: ${s}`);
  };
  if (!/^-?[\d.,]+$/.test(clean) || !/\d/.test(clean)) fail();
  const lastDot = clean.lastIndexOf(".");
  const lastComma = clean.lastIndexOf(",");
  let intPart = clean;
  let frac = "";
  if (lastDot >= 0 && lastComma >= 0) {
    const dec = lastDot > lastComma ? "." : ",";
    const thou = dec === "." ? "," : ".";
    const at = clean.lastIndexOf(dec);
    intPart = clean.slice(0, at).split(thou).join("");
    frac = clean.slice(at + 1);
  } else if (lastComma >= 0) {
    const parts = clean.split(",");
    if (parts.length > 2) intPart = parts.join(""); // 1,234,567 → binlik
    else [intPart, frac] = [parts[0]!, parts[1]!];
  } else if (lastDot >= 0) {
    const parts = clean.split(".");
    if (parts.length > 2 || parts[1]!.length === 3) intPart = parts.join(""); // 5.000 / 1.250.000 → binlik
    else [intPart, frac] = [parts[0]!, parts[1]!];
  }
  if (intPart.includes(".") || intPart.includes(",")) fail();
  if (!/^-?\d+$/.test(intPart || "0") || !/^\d{0,2}$/.test(frac)) fail();
  const neg = intPart.startsWith("-");
  const k = Math.abs(Number(intPart || "0")) * 100 + Number((frac + "00").slice(0, 2));
  if (!Number.isSafeInteger(k)) fail();
  return neg ? -k : k;
};
