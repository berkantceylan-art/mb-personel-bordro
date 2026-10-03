import Link from "next/link";
import { isoWeekday } from "@mb/core";
import { PageHeader } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { formatDate, getSession, todayIso } from "@/lib/session";
import type { ShiftRow } from "@/lib/timekeeping";
import { PlanGrid, type PlanEmployee } from "../PlanGrid";

const addDays = (iso: string, n: number) => new Date(Date.parse(iso + "T00:00:00Z") + n * 86_400_000).toISOString().slice(0, 10);

export default async function PlanPage({ searchParams }: { searchParams: Promise<{ hafta?: string; bolum?: string }> }) {
  await getSession();
  const sp = await searchParams;
  const base = sp.hafta && /^\d{4}-\d{2}-\d{2}$/.test(sp.hafta) ? sp.hafta : todayIso();
  const monday = addDays(base, 1 - isoWeekday(base));
  const dates = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  const supabase = await createClient();
  const [{ data: emps }, { data: shifts }, { data: assigns }, { data: departments }] = await Promise.all([
    supabase.from("employees").select("id, first_name, last_name, default_shift_id, departments(name)").eq("status", "active"),
    supabase.from("shifts").select("*").eq("active", true).order("code"),
    supabase.from("shift_assignments").select("employee_id, work_date, shift_id, day_type").gte("work_date", dates[0]!).lte("work_date", dates[6]!),
    supabase.from("departments").select("name").order("name"),
  ]);
  const employees: PlanEmployee[] = (emps ?? [])
    .map((e) => ({ id: e.id, name: `${e.first_name} ${e.last_name}`, dept: (e.departments as unknown as { name: string } | null)?.name ?? "Bölümsüz", defaultShiftId: e.default_shift_id }))
    .filter((e) => !sp.bolum || e.dept === sp.bolum)
    .sort((a, b) => a.dept.localeCompare(b.dept, "tr") || a.name.localeCompare(b.name, "tr"));
  const initial: Record<string, string> = {};
  for (const a of assigns ?? []) initial[`${a.employee_id}|${a.work_date}`] = a.day_type === "WEEKLY_OFF" ? "OFF" : (a.shift_id ?? "");
  const planShifts = ((shifts ?? []) as ShiftRow[]).map((s) => ({
    id: s.id, code: s.code, name: s.name, color: s.color, weekdays: s.weekdays,
    hours: `${s.start_time.slice(0, 5)}–${s.end_time.slice(0, 5)}`,
  }));
  const q = (h: string) => `/vardiyalar/plan?hafta=${h}${sp.bolum ? `&bolum=${encodeURIComponent(sp.bolum)}` : ""}`;

  return (
    <>
      <PageHeader
        title="Haftalık vardiya planı"
        subtitle={`${formatDate(dates[0]!)} – ${formatDate(dates[6]!)}`}
        actions={
          <div className="flex gap-2 items-center flex-wrap">
            <Link href={q(addDays(monday, -7))} className="h-11 px-3 inline-flex items-center rounded-[10px] border border-[#D5DEE8] bg-white font-semibold text-brand-700">← Önceki</Link>
            <Link href={q(todayIso())} className="h-11 px-3 inline-flex items-center rounded-[10px] border border-[#D5DEE8] bg-white font-semibold text-brand-700">Bu hafta</Link>
            <Link href={q(addDays(monday, 7))} className="h-11 px-3 inline-flex items-center rounded-[10px] border border-[#D5DEE8] bg-white font-semibold text-brand-700">Sonraki →</Link>
          </div>
        }
      />
      <div className="p-4 md:p-6 flex flex-col gap-4">
        <form className="flex gap-3">
          <input type="hidden" name="hafta" value={monday} />
          <select name="bolum" defaultValue={sp.bolum ?? ""} aria-label="Bölüm" className="h-11 rounded-[10px] border border-[#D5DEE8] bg-white px-3">
            <option value="">Tüm bölümler</option>
            {(departments ?? []).map((d) => <option key={d.name} value={d.name}>{d.name}</option>)}
          </select>
          <button className="h-11 px-4 rounded-[10px] bg-brand-700 text-white font-semibold">Filtrele</button>
          <Link href="/vardiyalar" className="h-11 px-3 inline-flex items-center text-sm font-semibold text-brand-700">Vardiya tanımları</Link>
        </form>
        <PlanGrid key={monday + (sp.bolum ?? "")} dates={dates} employees={employees} shifts={planShifts} initial={initial} />
      </div>
    </>
  );
}
