/** TR IBAN: boşlukları at, büyük harf; mod-97 doğrulaması ve banka adı (banka kodu: 5–9. haneler) */
export const ibanClean = (s: string) => s.replace(/[\s-]/g, "").toUpperCase();
export function ibanValid(raw: string): boolean {
  const s = ibanClean(raw);
  if (!/^TR\d{24}$/.test(s)) return false;
  const r = (s.slice(4) + s.slice(0, 4)).replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let m = 0;
  for (const ch of r) m = (m * 10 + Number(ch)) % 97;
  return m === 1;
}
export const ibanPretty = (raw: string) => ibanClean(raw).replace(/(.{4})/g, "$1 ").trim();
const BANKS: Record<string, string> = {
  "00010": "Ziraat Bankası", "00012": "Halkbank", "00015": "VakıfBank", "00032": "TEB", "00046": "Akbank", "00059": "Şekerbank",
  "00062": "Garanti BBVA", "00064": "İş Bankası", "00067": "Yapı Kredi", "00099": "ING", "00103": "Fibabanka", "00111": "QNB",
  "00123": "HSBC", "00124": "Alternatifbank", "00125": "Burgan Bank", "00134": "DenizBank", "00135": "Anadolubank", "00146": "Odeabank",
  "00203": "Albaraka Türk", "00205": "Kuveyt Türk", "00206": "Türkiye Finans", "00209": "Ziraat Katılım", "00210": "Vakıf Katılım",
  "00211": "Emlak Katılım", "00829": "Enpara", "00109": "ICBC Turkey",
};
export const ibanBank = (raw: string) => { const s = ibanClean(raw); return /^TR\d{24}$/.test(s) ? BANKS[s.slice(4, 9)] ?? null : null; };
