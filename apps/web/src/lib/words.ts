const ONES = ["", "bir", "iki", "üç", "dört", "beş", "altı", "yedi", "sekiz", "dokuz"];
const TENS = ["", "on", "yirmi", "otuz", "kırk", "elli", "altmış", "yetmiş", "seksen", "doksan"];
const GROUPS = ["", "bin", "milyon", "milyar"];

function hundreds(n: number): string {
  const h = Math.floor(n / 100), t = Math.floor((n % 100) / 10), o = n % 10;
  return `${h ? (h === 1 ? "" : ONES[h]) + "yüz" : ""}${TENS[t]}${ONES[o]}`;
}

/** 12345 → "onikibinüçyüzkırkbeş" (Türkçe, bitişik — makbuz yazımı) */
export function numberToWords(n: number): string {
  if (n === 0) return "sıfır";
  let out = "";
  let g = 0;
  while (n > 0) {
    const chunk = n % 1000;
    if (chunk) {
      const w = g === 1 && chunk === 1 ? "" : hundreds(chunk);
      out = `${w}${GROUPS[g]}${out}`;
    }
    n = Math.floor(n / 1000);
    g++;
  }
  return out;
}

/** Kuruş → "Yalnız: beşbin TL elli Kr." */
export function amountInWords(kurus: number): string {
  const tl = Math.floor(kurus / 100);
  const kr = Math.round(kurus % 100);
  return `Yalnız: ${numberToWords(tl)} TL${kr ? ` ${numberToWords(kr)} Kr.` : ""}`;
}
