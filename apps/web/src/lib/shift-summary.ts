/** Vardiya özeti: günlük / haftalık çalışma ve dinlenme süreleri + yasal kontroller (İş K. 41, 46, 63, 68, 69) */
export type ShiftInput = { start: string; end: string; crossesMidnight: boolean; breakMinutes: number; breakPaid: boolean; weekdays: number[] };
export type ShiftSummary = {
  spanMin: number;          // giriş–çıkış arası (işyerinde kalış)
  breakMin: number;
  netMin: number;           // günlük net çalışma (ücretsiz mola düşülmüş)
  restBetweenMin: number;   // iki vardiya arası dinlenme (24 saat − kalış)
  days: number;             // haftalık çalışma günü
  offDays: number;          // hafta tatili günü
  weeklyNetMin: number;
  weeklyRestMin: number;    // haftalık toplam dinlenme (168 saat − haftalık kalış)
  overUnder45Min: number;   // 45 saate göre fark (+ fazla, − eksik)
  nightMin: number;         // 20:00–06:00 arasına düşen süre
  warnings: string[];
};

const hm = (t: string) => {
  const [h, m] = (t || "0:0").split(":").map(Number) as [number, number];
  return (h || 0) * 60 + (m || 0);
};

/** Ara dinlenme alt sınırı (İş K. 68): ≤4 sa 15 dk, 4–7,5 sa 30 dk, >7,5 sa 1 saat */
export const minBreakFor = (workMin: number) => (workMin <= 240 ? 15 : workMin <= 450 ? 30 : 60);

export function shiftSummary(s: ShiftInput): ShiftSummary {
  const start = hm(s.start);
  let end = hm(s.end);
  if (s.crossesMidnight || end <= start) end += 1440;
  const spanMin = Math.max(0, end - start);
  const breakMin = Math.max(0, s.breakMinutes || 0);
  const workMin = Math.max(0, spanMin - breakMin);           // fiilen çalışılan (mola hariç)
  const netMin = s.breakPaid ? spanMin : workMin;              // ücret açısından sayılan
  const days = new Set(s.weekdays).size;
  const offDays = 7 - days;
  const weeklyNetMin = netMin * days;
  const weeklyRestMin = Math.max(0, 7 * 1440 - spanMin * days);
  // gece: 20:00–06:00 (iki günlük pencere)
  let nightMin = 0;
  for (const [a, b] of [[0, 360], [1200, 1800], [2640, 2880]] as const) nightMin += Math.max(0, Math.min(end, b) - Math.max(start, a));

  const warnings: string[] = [];
  if (workMin > 11 * 60) warnings.push("Günlük çalışma 11 saati aşıyor (İş K. 63).");
  if (breakMin < minBreakFor(workMin)) warnings.push(`Mola en az ${minBreakFor(workMin)} dk olmalı (İş K. 68).`);
  if (nightMin >= spanMin / 2 && workMin > 450) warnings.push("Gece vardiyasında çalışma 7,5 saati aşamaz (İş K. 69).");
  if (spanMin > 0 && 1440 - spanMin < 11 * 60) warnings.push("İki vardiya arası dinlenme 11 saatten az.");
  if (days > 0 && offDays === 0) warnings.push("Haftada en az 1 gün (24 saat kesintisiz) hafta tatili olmalı (İş K. 46).");
  if (weeklyNetMin > 45 * 60) warnings.push(`Haftalık ${(weeklyNetMin / 60).toLocaleString("tr-TR", { maximumFractionDigits: 1 })} saat: 45 saati aşan kısım fazla mesaidir (İş K. 41).`);
  return { spanMin, breakMin, netMin, restBetweenMin: Math.max(0, 1440 - spanMin), days, offDays, weeklyNetMin, weeklyRestMin, overUnder45Min: weeklyNetMin - 45 * 60, nightMin, warnings };
}

export const dur = (m: number) => {
  const sign = m < 0 ? "−" : "";
  const a = Math.abs(Math.round(m));
  const h = Math.floor(a / 60);
  const mm = a % 60;
  return `${sign}${h} sa${mm ? ` ${mm} dk` : ""}`;
};
