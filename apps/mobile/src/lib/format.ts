/** Kuruş → "12.345,67 ₺" */
export const tl = (k: number | null | undefined) =>
  `${(Number(k ?? 0) / 100).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₺`;

/** "5.000" / "5000,50" → kuruş; okunamazsa null */
export function parseTL(v: string): number | null {
  const s = v.replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", ".");
  const n = Number(s);
  return s && Number.isFinite(n) ? Math.round(n * 100) : null;
}

export const dmy = (iso: string | null | undefined) => (iso ? iso.slice(0, 10).split("-").reverse().join(".") : "—");

/** "26.10.2026" → "2026-10-26" (geçersizse null) */
export function isoFromDmy(v: string): string | null {
  const m = v.trim().match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  if (!m) return null;
  const iso = `${m[3]}-${m[2]!.padStart(2, "0")}-${m[1]!.padStart(2, "0")}`;
  return Number.isNaN(Date.parse(iso)) ? null : iso;
}

/** İstanbul saatine göre bugün / bu ay */
export const istanbulNow = () => new Date(Date.now() + 3 * 3600_000);
export const todayIso = () => istanbulNow().toISOString().slice(0, 10);
export const currentPeriod = () => todayIso().slice(0, 7);

const MONTHS = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
export const periodLabel = (p: string) => `${MONTHS[Number(p.slice(5, 7)) - 1]} ${p.slice(0, 4)}`;

export const timeOf = (iso: string) => new Date(iso).toLocaleTimeString("tr-TR", { timeZone: "Europe/Istanbul", hour: "2-digit", minute: "2-digit" });

export const TYPE_LABEL: Record<string, string> = {
  ACCRUAL: "Hakediş",
  BONUS: "Prim",
  OVERTIME: "Fazla mesai",
  ADVANCE: "Avans",
  SALARY: "Maaş ödemesi",
  BES: "BES kesintisi",
  GARNISHMENT: "İcra kesintisi",
  DEDUCTION: "Kesinti",
  ADJUSTMENT: "Düzeltme",
};

export const STATUS: Record<string, { label: string; bg: string; fg: string }> = {
  pending: { label: "Bekliyor", bg: "#FFF4E0", fg: "#8A5300" },
  approved: { label: "Onaylandı", bg: "#E6F4EC", fg: "#17603C" },
  rejected: { label: "Reddedildi", bg: "#FDECEA", fg: "#9B1C14" },
  cancelled: { label: "İptal", bg: "#EEF2F6", fg: "#33414F" },
};

/** Web bağlantılarını uygulama ekranlarına çevirir */
export function appRoute(link: string | null | undefined, isManager: boolean): string {
  if (!link) return "/bildirimler";
  if (link.startsWith("/mesajlar/")) return `/mesaj/${link.split("/")[2]}`;
  if (link.startsWith("/mesajlar")) return "/mesajlar";
  if (link.startsWith("/duyurular")) return "/duyurular";
  if (link.startsWith("/talepler")) return isManager ? "/yonetim" : "/talepler";
  if (link.startsWith("/benim")) return "/talepler";
  return "/bildirimler";
}
