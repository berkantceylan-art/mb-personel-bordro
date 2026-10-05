// Haftalık çalışma saatleri: istemci ve sunucuda kullanılabilir (saf fonksiyonlar)
import type { Locale } from "./i18n";

/** Pazartesi'den Pazar'a 7 kayıt; her biri "" (kapalı) ya da "09:00-18:00" */
export type Schedule = string[];

export const TIME_ZONE = "Europe/Istanbul";
const RANGE_RE = /^([01]\d|2[0-3]):([0-5]\d)-([01]\d|2[0-4]):([0-5]\d)$/;

export const DAY_NAMES: Record<Locale, string[]> = {
  tr: ["Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi", "Pazar"],
  en: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
  fr: ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"],
};

export const HOURS_UI: Record<Locale, { open: string; closed: string; opensAt: (d: string, t: string) => string; closesAt: (t: string) => string; closedDay: string; tz: string; today: string }> = {
  tr: {
    open: "Şu an açığız",
    closed: "Şu an kapalıyız",
    opensAt: (d, t) => `Açılış: ${d} ${t}`,
    closesAt: (t) => `Kapanış: ${t}`,
    closedDay: "Kapalı",
    tz: "Türkiye saati",
    today: "bugün",
  },
  en: {
    open: "We're open now",
    closed: "We're closed now",
    opensAt: (d, t) => `Opens ${d} at ${t}`,
    closesAt: (t) => `Open until ${t}`,
    closedDay: "Closed",
    tz: "Turkey time",
    today: "today",
  },
  fr: {
    open: "Nous sommes ouverts",
    closed: "Nous sommes fermés",
    opensAt: (d, t) => `Ouvre ${d} à ${t}`,
    closesAt: (t) => `Ouvert jusqu’à ${t}`,
    closedDay: "Fermé",
    tz: "heure de Turquie",
    today: "aujourd’hui",
  },
};

export function normalizeRange(v: unknown): string {
  if (typeof v !== "string") return "";
  const s = v.replace(/\s+/g, "").replace(/[–—]/g, "-").replace(/\./g, ":");
  const m = RANGE_RE.exec(s);
  if (!m) return "";
  if (`${m[3]}:${m[4]}` <= `${m[1]}:${m[2]}`) return "";
  return s;
}

export function normalizeSchedule(v: unknown): Schedule {
  const arr = Array.isArray(v) ? v : [];
  return Array.from({ length: 7 }, (_, i) => normalizeRange(arr[i]));
}

export const hasSchedule = (s: Schedule) => s.some(Boolean);

/** Türkiye saatine göre gün (0=Pazartesi) ve dakika */
function nowInTz(now: Date): { day: number; min: number } {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: TIME_ZONE, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const day = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(get("weekday"));
  return { day: day < 0 ? 0 : day, min: Number(get("hour")) * 60 + Number(get("minute")) };
}

const TOMORROW: Record<Locale, string> = { tr: "yarın", en: "tomorrow", fr: "demain" };

const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

export type OpenState = { open: boolean; label: string };

/** Şu an açık mı ve kısa açıklama ("18:00'e kadar açık" / "Pazartesi 09:00'da açılıyor") */
export function openState(schedule: Schedule, locale: Locale, now = new Date()): OpenState | null {
  if (!hasSchedule(schedule)) return null;
  const ui = HOURS_UI[locale];
  const { day, min } = nowInTz(now);
  const today = schedule[day];
  if (today) {
    const [a, b] = today.split("-");
    if (min >= toMin(a) && min < toMin(b)) return { open: true, label: ui.closesAt(b) };
    if (min < toMin(a)) return { open: false, label: ui.opensAt(ui.today, a) };
  }
  for (let i = 1; i <= 7; i++) {
    const d = (day + i) % 7;
    if (schedule[d]) return { open: false, label: ui.opensAt(i === 1 ? TOMORROW[locale] : DAY_NAMES[locale][d], schedule[d].split("-")[0]) };
  }
  return { open: false, label: "" };
}

/** Ardışık aynı saatleri gruplar: "Pazartesi – Cuma 09:00–18:00" */
export function groupedSchedule(schedule: Schedule, locale: Locale): { days: string; hours: string }[] {
  const names = DAY_NAMES[locale];
  const out: { days: string; hours: string }[] = [];
  let i = 0;
  while (i < 7) {
    let j = i;
    while (j + 1 < 7 && schedule[j + 1] === schedule[i]) j++;
    out.push({
      days: i === j ? names[i] : `${names[i]} – ${names[j]}`,
      hours: schedule[i] ? schedule[i].replace("-", "–") : HOURS_UI[locale].closedDay,
    });
    i = j + 1;
  }
  return out;
}
