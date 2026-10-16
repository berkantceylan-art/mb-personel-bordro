/** Ödeme merkezi — tipler, etiketler, dönem yardımcıları (sunucu + istemci) */

export type PayRow = {
  src: string; kind: string; ref: string | null; who_id: string | null; title: string; sub: string | null; due_date: string;
  amount_try: number; amount: number; currency: string; overdue: boolean; urgent: boolean; link: string; estimate: boolean;
};

export const SRC: Record<string, { label: string; icon: string; tone: string; bar: string }> = {
  supplier: { label: "Tedarikçi", icon: "🏭", tone: "bg-[#EEF4FB] text-brand-700", bar: "#0f4c8a" },
  personnel: { label: "Personel / maaş", icon: "👥", tone: "bg-[#F1ECFB] text-[#5B3BA8]", bar: "#7C5CC4" },
  advance: { label: "Avans talebi", icon: "🙋", tone: "bg-[#FFF1E6] text-[#A3520B]", bar: "#E08A2E" },
  tax: { label: "Vergi / SGK", icon: "🏛", tone: "bg-[#FDECEA] text-bad", bar: "#C0453A" },
  loan: { label: "Kredi taksiti", icon: "🏦", tone: "bg-[#E8F5F1] text-[#1F6F5C]", bar: "#2E9C82" },
  card: { label: "Kredi kartı", icon: "💳", tone: "bg-[#E9F2FF] text-[#1D4E9E]", bar: "#3B7BE0" },
  expense: { label: "Tekrarlayan masraf", icon: "🔁", tone: "bg-[#F2F4F7] text-[#475467]", bar: "#7A8699" },
  rent: { label: "Kira", icon: "🏢", tone: "bg-[#F2F4F7] text-[#475467]", bar: "#7A8699" },
  utility: { label: "Fatura (elektrik, su…)", icon: "💡", tone: "bg-[#FFF8DB] text-[#8A6A00]", bar: "#D4A800" },
  other: { label: "Diğer", icon: "📌", tone: "bg-[#F2F4F7] text-[#475467]", bar: "#98A2B3" },
};
export const srcOf = (s: string) => SRC[s] ?? SRC.other!;

/** Filtre çipleri: birden çok kaynak tek grupta */
export const GROUPS: [string, string, string[]][] = [
  ["tedarikci", "🏭 Tedarikçi", ["supplier"]],
  ["personel", "👥 Personel", ["personnel", "advance"]],
  ["vergi", "🏛 Vergi / SGK", ["tax"]],
  ["kredi", "🏦 Kredi / kart", ["loan", "card"]],
  ["masraf", "🔁 Masraf / kira", ["expense", "rent", "utility", "other"]],
];

export const PLAN_CATS: [string, string][] = [["rent", "Kira"], ["utility", "Fatura (elektrik, su, internet…)"], ["tax", "Vergi / SGK"], ["personnel", "Personel"], ["loan", "Kredi"], ["other", "Diğer"]];

export const iso = (d: Date) => d.toISOString().slice(0, 10);
export const todayTR = () => iso(new Date(Date.now() + 3 * 3600 * 1000));
export const addDays = (s: string, n: number) => iso(new Date(Date.parse(s) + n * 864e5));
export const weekStart = (s: string) => { const wd = (new Date(Date.parse(s)).getUTCDay() + 6) % 7; return addDays(s, -wd); };
export const monthStart = (s: string) => `${s.slice(0, 7)}-01`;
export const monthEnd = (s: string) => { const [y, m] = s.slice(0, 7).split("-").map(Number); return iso(new Date(Date.UTC(y!, m!, 0))); };
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);

const DAY = ["Pazar", "Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi"];
const MON = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
export const dayLabel = (s: string) => { const d = new Date(Date.parse(s)); return `${d.getUTCDate()} ${MON[d.getUTCMonth()]} ${DAY[d.getUTCDay()]}`; };
export const monthLabel = (s: string) => `${MON[Number(s.slice(5, 7)) - 1]} ${s.slice(0, 4)}`;
export const shortDay = (s: string) => DAY[new Date(Date.parse(s)).getUTCDay()]!.slice(0, 3);

export type View = "gun" | "hafta" | "ay" | "acil";
/** Görünüme göre aralık */
export function rangeFor(view: View, t?: string) {
  const today = todayTR();
  const base = t && /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : today;
  if (view === "gun") return { from: base, to: base, prev: addDays(base, -1), next: addDays(base, 1), base };
  if (view === "hafta") { const w = weekStart(base); return { from: w, to: addDays(w, 6), prev: addDays(w, -7), next: addDays(w, 7), base: w }; }
  if (view === "ay") { const m = monthStart(base); return { from: m, to: monthEnd(m), prev: monthStart(addDays(m, -1)), next: addDays(monthEnd(m), 1), base: m }; }
  return { from: today, to: addDays(today, 3), prev: today, next: today, base: today };
}

export function payError(m: string): string {
  if (/pay_center|fin_payment_plans|schema cache|does not exist/.test(m)) return "Supabase'de mbdental-odeme-merkezi.sql çalıştırılmalı.";
  if (/title_required/.test(m)) return "Ödemenin adını yazın (ör. Kira, Elektrik).";
  if (/amount_required/.test(m)) return "Tutar girin.";
  if (/date_required/.test(m)) return "Ödeme tarihini seçin.";
  if (/not_allowed/.test(m)) return "Bu işlem için yetkiniz yok.";
  return m;
}
