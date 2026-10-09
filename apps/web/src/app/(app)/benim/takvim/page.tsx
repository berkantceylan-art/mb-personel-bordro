import { Card } from "@/components/ui";
import { PeriodPicker } from "@/components/PeriodPicker";
import { currentPeriod, periodLabel } from "@/lib/session";
import { me, MyHeader, NotLinked } from "../_shared";

const DOW = ["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"];

/** Vardiyam ve takvim: vardiya kodu, tatiller, izinler, çalışılan günler */
export default async function MyCalendarPage({ searchParams }: { searchParams: Promise<{ donem?: string }> }) {
  const { supabase, me: e } = await me();
  if (!e) return <NotLinked title="Takvimim" />;
  const sp = await searchParams;
  const period = sp.donem && /^\d{4}-\d{2}$/.test(sp.donem) ? sp.donem : currentPeriod();
  const [y, m] = period.split("-").map(Number);
  const days = new Date(y, m, 0).getDate();
  const first = `${period}-01`; const last = `${period}-${String(days).padStart(2, "0")}`;
  const [{ data: emp }, { data: shifts }, { data: assigns }, { data: hol }, { data: leaves }, { data: punches }] = await Promise.all([
    supabase.from("employees").select("default_shift_id").eq("id", e.id).maybeSingle(),
    supabase.from("shifts").select("id, code, name, start_time, end_time, weekdays, color"),
    supabase.from("shift_assignments").select("work_date, shift_id, day_type").eq("employee_id", e.id).gte("work_date", first).lte("work_date", last),
    supabase.from("public_holidays").select("date, name, half_day").gte("date", first).lte("date", last),
    supabase.from("leave_requests").select("start_date, end_date, status, hours, leave_types(name, code, color)").eq("employee_id", e.id).in("status", ["approved", "pending"]).lte("start_date", last).gte("end_date", first),
    supabase.from("attendance_punches").select("punched_at, direction").eq("employee_id", e.id).gte("punched_at", `${first}T00:00:00`).lte("punched_at", `${last}T23:59:59`),
  ]);
  const shiftById = new Map((shifts ?? []).map((s) => [s.id, s]));
  const assignByDay = new Map((assigns ?? []).map((a) => [a.work_date, a]));
  const holByDay = new Map((hol ?? []).map((h) => [h.date, h]));
  const leaveByDay = new Map<string, { name: string; color: string; pending: boolean; hours: number | null }>();
  for (const l of leaves ?? []) {
    const t = l.leave_types as unknown as { name: string; code: string; color: string } | null;
    for (let d = new Date(l.start_date + "T12:00:00"); d.toISOString().slice(0, 10) <= l.end_date; d.setDate(d.getDate() + 1)) {
      const k = d.toISOString().slice(0, 10); if (k >= first && k <= last) leaveByDay.set(k, { name: t?.name ?? "İzin", color: t?.color ?? "#E6F4EC", pending: l.status === "pending", hours: l.hours ? Number(l.hours) : null });
    }
  }
  const worked = new Map<string, { in?: string; out?: string }>();
  for (const p of punches ?? []) { const k = p.punched_at.slice(0, 10); const c = worked.get(k) ?? {}; if (p.direction === "IN" && !c.in) c.in = p.punched_at.slice(11, 16); if (p.direction === "OUT") c.out = p.punched_at.slice(11, 16); worked.set(k, c); }
  const today = new Date().toISOString().slice(0, 10);
  const defShift = emp?.default_shift_id ? shiftById.get(emp.default_shift_id) : null;
  const cur = currentPeriod();
  const options = [...Array(6)].map((_, k) => { const d = new Date(Number(cur.slice(0, 4)), Number(cur.slice(5, 7)) - 1 - k + 1, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; });
  const startDow = (new Date(y, m - 1, 1).getDay() + 6) % 7;
  const cells: Array<string | null> = [...Array(startDow).fill(null), ...Array.from({ length: days }, (_, i) => `${period}-${String(i + 1).padStart(2, "0")}`)];
  const info = (d: string) => {
    const a = assignByDay.get(d); const sh = a?.shift_id ? shiftById.get(a.shift_id) : defShift;
    const dow = ((new Date(d + "T12:00:00").getDay() + 6) % 7) + 1;
    const off = a?.day_type === "WEEKLY_OFF" || (sh ? !sh.weekdays.includes(dow) : dow === 7);
    return { sh, off, hol: holByDay.get(d), lv: leaveByDay.get(d), w: worked.get(d) };
  };
  return (
    <>
      <MyHeader title="Takvimim" subtitle={`${periodLabel(period)}${defShift ? ` · vardiya ${defShift.name} ${String(defShift.start_time).slice(0, 5)}–${String(defShift.end_time).slice(0, 5)}` : ""}`} />
      <div className="p-4 md:p-6 flex flex-col gap-4 max-w-[760px]">
        <PeriodPicker value={period} options={[...new Set(options)]} />
        <Card>
          <div className="grid grid-cols-7 gap-1 text-center text-[11px] text-muted">{DOW.map((d) => <div key={d}>{d}</div>)}</div>
          <div className="grid grid-cols-7 gap-1">
            {cells.map((d, i) => {
              if (!d) return <div key={`e${i}`} />;
              const x = info(d);
              const bg = x.hol && !x.hol.half_day ? "bg-[#FDECEA]" : x.lv ? "" : x.off ? "bg-[#EEF2F6]" : "bg-white";
              return (
                <div key={d} style={x.lv ? { background: x.lv.color } : undefined} className={`rounded-lg border ${d === today ? "border-brand-700" : "border-[#EEF2F6]"} ${bg} min-h-[64px] p-1 flex flex-col gap-0.5`}>
                  <div className={`text-xs font-semibold ${d === today ? "text-brand-700" : ""}`}>{Number(d.slice(8, 10))}</div>
                  {x.hol && <div className="text-[10px] leading-tight text-bad">{x.hol.half_day ? "Arife ½" : x.hol.name.split(" ")[0]}</div>}
                  {x.lv && <div className="text-[10px] leading-tight">{x.lv.hours ? `${x.lv.hours} sa izin` : x.lv.name.split(" ")[0]}{x.lv.pending ? " ?" : ""}</div>}
                  {!x.off && !x.hol && !x.lv && x.sh && <div className="text-[10px] text-muted leading-tight">{x.sh.code}</div>}
                  {x.w?.in && <div className="num text-[10px] text-ok leading-tight">{x.w.in}{x.w.out ? `–${x.w.out}` : ""}</div>}
                  {x.off && !x.lv && !x.hol && <div className="text-[10px] text-muted">tatil</div>}
                </div>
              );
            })}
          </div>
          <div className="flex flex-wrap gap-3 text-[11px] text-muted mt-2">
            <span><span className="inline-block w-3 h-3 rounded bg-[#EEF2F6] align-middle mr-1" />hafta tatili</span>
            <span><span className="inline-block w-3 h-3 rounded bg-[#FDECEA] align-middle mr-1" />resmi tatil</span>
            <span><span className="inline-block w-3 h-3 rounded bg-[#E6F4EC] align-middle mr-1" />izin (? = onay bekliyor)</span>
            <span className="text-ok">yeşil saat = okutma</span>
          </div>
        </Card>
        <p className="text-xs text-muted">İzin isterken bu takvime bakın: tatil ve izinli günler zaten dolu. Vardiya değişiklikleri şefiniz tarafından girilir.</p>
      </div>
    </>
  );
}
