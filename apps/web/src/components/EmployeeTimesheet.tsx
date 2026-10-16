import { loadMonth } from "@/lib/timekeeping";
import { periodLabel } from "@/lib/session";
import type { createClient } from "@/lib/supabase/server";

type SB = Awaited<ReturnType<typeof createClient>>;
const DAY = ["Paz", "Pzt", "Sal", "Çar", "Per", "Cum", "Cmt"];
const ST: Record<string, [string, string]> = {
  WORKED: ["Çalıştı", "text-ok"], INCOMPLETE: ["Eksik okutma", "text-warn"], ABSENT: ["Gelmedi", "text-bad"], WEEKLY_OFF: ["Hafta tatili", "text-muted"],
  HOLIDAY: ["Resmi tatil", "text-muted"], LEAVE: ["İzinli", "text-brand-700"], NO_SHIFT: ["Vardiya yok", "text-muted"],
};
const hm = (min: number) => (min ? `${Math.floor(min / 60)}:${String(Math.round(min % 60)).padStart(2, "0")}` : "");
const t = (iso: string | null) => (iso ? iso.slice(11, 16) : "");

/** Tek personelin aylık puantajı: gün gün giriş / çıkış, çalışılan süre, geç kalma, erken çıkış, fazla mesai, izin / tatil */
export async function EmployeeTimesheet({ supabase, employeeId, period, compact }: { supabase: SB; employeeId: string; period: string; compact?: boolean }) {
  const md = await loadMonth(supabase, period, { employeeId });
  const row = md.cells.get(employeeId);
  if (!row) return <p className="text-sm text-muted">{periodLabel(period)} döneminde puantaj kaydı yok (işe giriş / çıkış tarihlerinin dışında olabilir).</p>;
  const cells = md.days.map((d) => row.get(d)).filter((c): c is NonNullable<typeof c> => !!c && c.employed);
  const sum = (k: "workedMin" | "lateMin" | "earlyLeaveMin" | "overtimeMin") => cells.reduce((a, c) => a + (c[k] ?? 0), 0);
  const cnt = (s: string) => cells.filter((c) => c.status === s).length;
  const today = new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10);
  const shown = cells.filter((c) => c.date <= today);
  const cell = compact ? "py-1.5 px-2 border-b border-[#EEF2F6]" : "py-1 px-1.5 border border-[#9AA7B4]";
  return (
    <div className="flex flex-col gap-3">
      <div className={`grid gap-2 ${compact ? "grid-cols-3 md:grid-cols-6" : "grid-cols-6"} text-center`}>
        {[["Çalışılan", hm(sum("workedMin")) || "0:00"], ["Çalıştığı gün", String(cnt("WORKED") + cnt("INCOMPLETE"))], ["Gelmedi", String(cnt("ABSENT"))], ["İzinli", String(cnt("LEAVE"))], ["Geç kalma", hm(sum("lateMin")) || "0"], ["Fazla mesai", hm(sum("overtimeMin")) || "0"]].map(([l, v]) => (
          <div key={l} className={compact ? "rounded-xl border border-line p-2" : "border border-[#9AA7B4] p-1.5"}><div className="text-[10px] text-muted">{l}</div><div className="font-bold tabular-nums">{v}</div></div>
        ))}
      </div>
      <div className="overflow-x-auto">
        <table className={`w-full ${compact ? "text-[13px] min-w-[640px]" : "text-[10.5px] border-collapse"}`}>
          <thead><tr className={compact ? "text-left text-xs text-muted" : "bg-[#EEF2F6] text-left"}>
            <th className={cell}>Tarih</th><th className={cell}>Gün</th><th className={cell}>Vardiya</th><th className={cell}>Giriş</th><th className={cell}>Çıkış</th><th className={`${cell} text-right`}>Çalışma</th><th className={`${cell} text-right`}>Geç</th><th className={`${cell} text-right`}>Erken</th><th className={`${cell} text-right`}>F. mesai</th><th className={cell}>Durum</th>
          </tr></thead>
          <tbody>
            {shown.map((c) => {
              const wd = new Date(`${c.date}T12:00:00Z`).getUTCDay();
              const [label, tone] = ST[c.status] ?? [c.status, ""];
              return (
                <tr key={c.date} className={wd === 0 && compact ? "bg-[#F8FAFC]" : ""}>
                  <td className={`${cell} tabular-nums`}>{c.date.slice(8, 10)}.{c.date.slice(5, 7)}</td>
                  <td className={cell}>{DAY[wd]}</td>
                  <td className={cell}>{c.shiftCode ?? ""}</td>
                  <td className={`${cell} tabular-nums`}>{t(c.firstIn)}</td>
                  <td className={`${cell} tabular-nums`}>{t(c.lastOut)}</td>
                  <td className={`${cell} text-right tabular-nums`}>{hm(c.workedMin)}</td>
                  <td className={`${cell} text-right tabular-nums ${c.lateMin ? "text-bad" : ""}`}>{hm(c.lateMin)}</td>
                  <td className={`${cell} text-right tabular-nums ${c.earlyLeaveMin ? "text-warn" : ""}`}>{hm(c.earlyLeaveMin)}</td>
                  <td className={`${cell} text-right tabular-nums`}>{hm(c.overtimeMin)}</td>
                  <td className={`${cell} ${tone}`}>{c.leaveCode ? `İzin (${c.leaveCode})` : c.holidayName ? c.holidayName : label}{c.punchCount > 0 && c.status === "INCOMPLETE" ? ` · ${c.punchCount} okutma` : ""}</td>
                </tr>
              );
            })}
            {!shown.length && <tr><td colSpan={10} className={`${cell} text-center text-muted`}>Kayıt yok.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
