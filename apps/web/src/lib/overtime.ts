import { LIMITS, roundOvertime, weeklySummaries } from "@mb/core";
import type { MonthData } from "@/lib/timekeeping";

export interface OvertimeSuggestion {
  employeeId: string;
  name: string;
  dept: string;
  /** Kaydın yazılacağı gün */
  date: string;
  minutes: number;
  rate: number;
  kind: "WEEK" | "DAY" | "WEEKLY_OFF" | "HOLIDAY" | "HALF_HOLIDAY";
  /** Haftalık esasta: hafta aralığı ve haftalık toplam */
  week?: { start: string; end: string; workedMin: number };
}

export interface OvertimeWarning {
  employeeId: string;
  name: string;
  kind: "LONG_DAY" | "YEARLY";
  date?: string;
  minutes: number;
}

/**
 * Puantajdan fazla mesai önerileri.
 * - Resmi tatil (ve arife 13:00 sonrası) çalışması her zaman gün bazında, şirket ayarındaki katla.
 * - WEEKLY: pazartesi–pazar haftasında 45 saati aşan süre; haftası bu ayda biten haftalar.
 *   Ay başındaki yarım hafta için önceki ayın verisi (prev) kullanılır.
 * - DAILY: vardiya süresini eşik kadar aşan günler ve hafta tatili çalışması.
 * Süreler şirketin yuvarlama ayarına göre yuvarlanır (tatil çalışması hariç).
 */
export function overtimeSuggestions(m: MonthData, prev?: MonthData | null): { suggestions: OvertimeSuggestion[]; warnings: OvertimeWarning[] } {
  const { settings } = m;
  const first = m.days[0]!;
  const last = m.days[m.days.length - 1]!;
  const out: OvertimeSuggestion[] = [];
  const warnings: OvertimeWarning[] = [];

  for (const e of m.employees) {
    const cells = [...m.cells.get(e.id)!.values()].filter((c) => c.employed);
    const base = { employeeId: e.id, name: e.name, dept: e.dept };

    for (const c of cells) {
      if (c.overtimeMin <= 0) continue;
      if (c.status === "HOLIDAY") out.push({ ...base, date: c.date, minutes: c.overtimeMin, rate: c.overtimeRate, kind: "HOLIDAY" });
      else if (c.halfHoliday) out.push({ ...base, date: c.date, minutes: c.overtimeMin, rate: c.overtimeRate, kind: "HALF_HOLIDAY" });
      else if (settings.overtimeBasis === "DAILY") {
        const minutes = roundOvertime(c.overtimeMin, settings.overtimeRounding);
        out.push({ ...base, date: c.date, minutes, rate: c.overtimeRate, kind: c.status === "WEEKLY_OFF" ? "WEEKLY_OFF" : "DAY" });
      }
    }

    if (settings.overtimeBasis !== "WEEKLY") {
      for (const c of cells) if (c.workedMin > LIMITS.dailyMaxWorkMinutes) warnings.push({ ...base, kind: "LONG_DAY", date: c.date, minutes: c.workedMin });
      continue;
    }
    const prevCells = prev?.cells.get(e.id) ? [...prev.cells.get(e.id)!.values()].filter((c) => c.employed) : [];
    const weeks = weeklySummaries([...prevCells, ...cells], LIMITS.weeklyMinutes);
    for (const c of cells) if (c.workedMin > LIMITS.dailyMaxWorkMinutes) warnings.push({ ...base, kind: "LONG_DAY", date: c.date, minutes: c.workedMin });
    for (const w of weeks) {
      // Haftası sonraki aya taşan son hafta sonraki ayda değerlendirilir
      if (w.weekEnd < first || w.weekEnd > last || w.overtimeMin <= 0) continue;
      const minutes = roundOvertime(w.overtimeMin, settings.overtimeRounding);
      const date = w.lastWorkedDate && w.lastWorkedDate >= first ? w.lastWorkedDate : first;
      out.push({ ...base, date, minutes, rate: 1.5, kind: "WEEK", week: { start: w.weekStart, end: w.weekEnd, workedMin: w.workedMin } });
    }
  }
  return { suggestions: out.sort((a, b) => a.dept.localeCompare(b.dept, "tr") || a.name.localeCompare(b.name, "tr") || a.date.localeCompare(b.date)), warnings };
}
