import { dur, type ShiftSummary } from "@/lib/shift-summary";

/** Vardiya özeti: günlük ve haftalık çalışma / dinlenme */
export function ShiftSummaryView({ s, compact = false }: { s: ShiftSummary; compact?: boolean }) {
  const cell = (label: string, value: string, tone?: "ok" | "warn") => (
    <div className="rounded-lg bg-[#F5F8FB] px-2.5 py-1.5">
      <div className="text-[11px] text-muted leading-tight">{label}</div>
      <div className={`num text-sm font-semibold ${tone === "warn" ? "text-warn" : tone === "ok" ? "text-ok" : "text-ink"}`}>{value}</div>
    </div>
  );
  return (
    <div className="flex flex-col gap-2">
      <div className={`grid gap-1.5 ${compact ? "grid-cols-2" : "grid-cols-2 sm:grid-cols-4"}`}>
        {cell("Günlük net çalışma", dur(s.netMin))}
        {cell("Mola", `${s.breakMin} dk`)}
        {cell("Vardiyalar arası dinlenme", dur(s.restBetweenMin), s.restBetweenMin < 660 ? "warn" : undefined)}
        {cell("İşyerinde kalış", dur(s.spanMin))}
        {cell(`Haftalık çalışma (${s.days} gün)`, dur(s.weeklyNetMin), s.weeklyNetMin > 2700 ? "warn" : undefined)}
        {cell(`Haftalık dinlenme (${s.offDays} gün tatil)`, dur(s.weeklyRestMin))}
        {cell("45 saate göre", s.overUnder45Min === 0 ? "tam 45 sa" : `${s.overUnder45Min > 0 ? "+" : ""}${dur(s.overUnder45Min)}`, s.overUnder45Min > 0 ? "warn" : "ok")}
        {cell("Gece (20:00–06:00)", s.nightMin ? dur(s.nightMin) : "—")}
      </div>
      {s.warnings.length > 0 && (
        <ul className="text-xs text-warn flex flex-col gap-0.5">{s.warnings.map((w) => <li key={w}>• {w}</li>)}</ul>
      )}
    </div>
  );
}
