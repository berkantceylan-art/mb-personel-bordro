import Link from "next/link";
import { shiftNetMinutes } from "@mb/core";
import { Card, PageHeader, PrimaryLink } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import { hhmm, toShiftDef, type ShiftRow } from "@/lib/timekeeping";
import { DefaultShiftForm, ShiftForm } from "./ShiftForms";
import { setShiftActive } from "./actions";

const DAYS = ["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"];

export default async function ShiftsPage({ searchParams }: { searchParams: Promise<{ duzenle?: string }> }) {
  await getSession();
  const { duzenle } = await searchParams;
  const supabase = await createClient();
  const [{ data: shifts }, { data: emps }, { data: departments }] = await Promise.all([
    supabase.from("shifts").select("*").order("active", { ascending: false }).order("code"),
    supabase.from("employees").select("id, first_name, last_name, default_shift_id").eq("status", "active").order("first_name"),
    supabase.from("departments").select("id, name").order("name"),
  ]);
  const rows = (shifts ?? []) as ShiftRow[];
  const usage = new Map<string, number>();
  for (const e of emps ?? []) if (e.default_shift_id) usage.set(e.default_shift_id, (usage.get(e.default_shift_id) ?? 0) + 1);
  const empName = new Map((emps ?? []).map((e) => [e.id, `${e.first_name} ${e.last_name}`]));
  const unassigned = (emps ?? []).filter((e) => !e.default_shift_id).length;
  const editing = rows.find((r) => r.id === duzenle);

  return (
    <>
      <PageHeader title="Vardiyalar" subtitle="Vardiyaları tanımlayın, personele varsayılan vardiya atayın, haftalık planı düzenleyin." actions={<PrimaryLink href="/vardiyalar/plan">Haftalık plan</PrimaryLink>} />
      <div className="p-6 md:p-8 flex flex-col gap-6 max-w-[1240px]">
        <section className="grid gap-4 grid-cols-[repeat(auto-fit,minmax(260px,1fr))]">
          {rows.map((s) => (
            <article key={s.id} className={`bg-white border border-line rounded-2xl p-4 flex flex-col gap-2 ${s.active ? "" : "opacity-50"}`}>
              <div className="flex items-center gap-3">
                <span className="w-10 h-10 rounded-lg grid place-items-center font-bold" style={{ background: s.color, color: s.color === "#1E3550" ? "#fff" : "#0A2540" }}>{s.code}</span>
                <div className="flex flex-col flex-1 min-w-0">
                  <span className="font-semibold">{s.name}</span>
                  <span className="num text-xs text-muted">{s.start_time.slice(0, 5)}–{s.end_time.slice(0, 5)} · net {hhmm(shiftNetMinutes(toShiftDef(s)))}</span>
                </div>
              </div>
              <span className="text-xs text-muted">{s.weekdays.map((d) => DAYS[d - 1]).join(" ")} · mola {s.break_minutes} dk{s.break_paid ? " (ücretli)" : ""} · tolerans {s.late_tolerance_min} dk · FM eşiği {s.overtime_threshold_min} dk</span>
              {s.employee_id && <span className="text-xs font-semibold text-[#5B3A9A]">Özel: {empName.get(s.employee_id) ?? "—"}</span>}
              <div className="flex justify-between items-center mt-1">
                <span className="text-xs text-muted">{usage.get(s.id) ?? 0} personelin varsayılanı</span>
                <div className="flex gap-3 text-xs font-semibold">
                  <Link href={`/vardiyalar?duzenle=${s.id}#form`} className="text-brand-700">Düzenle</Link>
                  <form action={setShiftActive}>
                    <input type="hidden" name="id" value={s.id} />
                    <input type="hidden" name="active" value={String(!s.active)} />
                    <button className="text-muted">{s.active ? "Pasif yap" : "Aktif yap"}</button>
                  </form>
                </div>
              </div>
            </article>
          ))}
        </section>

        <Card title="Varsayılan vardiya ata" action={unassigned ? <span className="text-xs font-semibold text-warn">{unassigned} personelin vardiyası yok</span> : undefined}>
          <DefaultShiftForm shifts={rows} departments={departments ?? []} />
        </Card>

        <div id="form" className="flex flex-col gap-2">
          <h2 className="font-display font-semibold text-brand-800">{editing ? `${editing.name} vardiyasını düzenle` : "Yeni vardiya / özel vardiya"}</h2>
          <ShiftForm key={editing?.id ?? "new"} shift={editing} employees={(emps ?? []).map((e) => ({ id: e.id, name: `${e.first_name} ${e.last_name}` }))} />
        </div>
      </div>
    </>
  );
}
