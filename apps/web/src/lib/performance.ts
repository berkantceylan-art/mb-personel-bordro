/** Performans ve yetkinlik yardımcıları */
import { nextPeriod } from "@mb/core";
import type { createClient } from "@/lib/supabase/server";
import { loadMonth } from "@/lib/timekeeping";
import { missed, tracked } from "@/lib/boss";

type SB = Awaited<ReturnType<typeof createClient>>;
export type Criterion = { key: string; label: string };

export const LEVELS = ["Yok", "Öğreniyor", "Gözetimle yapar", "Bağımsız yapar", "Usta · öğretebilir"] as const;
export const LEVEL_STYLE = ["bg-[#F2F4F7] text-[#6B7785]", "bg-[#FDECEA] text-[#9B1C1C]", "bg-[#FFF4E0] text-[#7A4F00]", "bg-[#E7F1FB] text-[#0A3D73]", "bg-[#0A3D73] text-white"] as const;

export const SCORE_LABEL: Record<number, string> = { 1: "Beklentinin çok altında", 2: "Geliştirilmeli", 3: "Beklentiyi karşılıyor", 4: "Beklentinin üstünde", 5: "Örnek performans" };

export function average(scores: Record<string, number> | null | undefined, criteria: Criterion[]): number | null {
  if (!scores) return null;
  const xs = criteria.map((c) => Number(scores[c.key])).filter((v) => v >= 1 && v <= 5);
  return xs.length ? Math.round((xs.reduce((a, v) => a + v, 0) / xs.length) * 100) / 100 : null;
}

/** Ortalama puana göre önerilen zam oranı (yönetici değiştirebilir) */
export const suggestedRaise = (overall: number | null) => (overall === null ? null : overall >= 4.5 ? 10 : overall >= 4 ? 7 : overall >= 3 ? 4 : overall >= 2 ? 0 : 0);

/** Dönem içindeki devam ve dakiklik (puantajdan) */
export async function attendanceFor(sb: SB, employeeId: string, from: string, to: string) {
  const end = to.slice(0, 7);
  let absent = 0, late = 0, lateMin = 0, worked = 0;
  for (let p = from.slice(0, 7), i = 0; p <= end && i < 13; p = nextPeriod(p), i++) {
    const m = await loadMonth(sb, p, { employeeId });
    const row = m.cells.get(employeeId);
    if (!row || !tracked(row)) continue;
    for (const [d, c] of row) {
      if (d < from || d > to || !c.employed) continue;
      if (missed(c, d)) absent++;
      if (c.punchCount > 0) worked++;
      if (c.lateMin > 0) { late++; lateMin += c.lateMin; }
    }
  }
  const [{ data: ot }, { data: lv }] = await Promise.all([
    sb.from("overtime_records").select("minutes").eq("employee_id", employeeId).eq("status", "approved").gte("work_date", from).lte("work_date", to),
    sb.from("leave_requests").select("days, leave_types(code)").eq("employee_id", employeeId).eq("status", "approved").gte("start_date", from).lte("start_date", to),
  ]);
  const sick = (lv ?? []).filter((l) => (l.leave_types as unknown as { code: string } | null)?.code === "RAPOR").reduce((a, l) => a + Number(l.days), 0);
  return { worked, absent, late, lateMin, overtimeHours: Math.round(((ot ?? []).reduce((a, r) => a + Number(r.minutes), 0) / 60) * 10) / 10, sickDays: sick };
}
