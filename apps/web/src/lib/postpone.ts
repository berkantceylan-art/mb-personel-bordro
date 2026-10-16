/** İş erteleme sebepleri ve tarih yardımcıları (istemci ve sunucu ortak) */
export const POSTPONE_REASONS: Record<string, string> = {
  capacity: "Yetişmedi / iş yükü",
  material: "Malzeme bekleniyor",
  doctor: "Hekim isteği",
  tryin: "Prova sonucu bekleniyor",
  remake: "Yeniden yapım",
  quality: "Kalite kontrolden döndü",
  other: "Diğer",
};

/** Türkiye saatine göre bugün (YYYY-AA-GG) */
export const todayTR = () => new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10);

/** Bir sonraki iş günü: pazar atlanır (cumartesi çalışılıyor) */
export function nextWorkday(from = todayTR(), days = 1): string {
  const d = new Date(`${from}T12:00:00Z`);
  let left = days;
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    if (d.getUTCDay() !== 0) left--;
  }
  return d.toISOString().slice(0, 10);
}
