import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { formatDate, getSession } from "@/lib/session";
import { hhmm, loadMonth } from "@/lib/timekeeping";
import { ManualPunchForm } from "../../PunchForms";
import { deletePunch } from "../../actions";
import { ConfirmSubmit } from "@/components/ConfirmSubmit";

const STATUS: Record<string, string> = {
  WORKED: "Çalıştı", INCOMPLETE: "Eksik okutma", ABSENT: "Devamsız", WEEKLY_OFF: "Hafta tatili",
  HOLIDAY: "Resmi tatil", LEAVE: "İzinli", NO_SHIFT: "Vardiya atanmamış",
};
const addDays = (iso: string, n: number) => new Date(Date.parse(iso + "T00:00:00Z") + n * 86_400_000).toISOString().slice(0, 10);

export default async function DayPage({ params }: { params: Promise<{ employeeId: string; date: string }> }) {
  const { employeeId, date } = await params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) notFound();
  await getSession();
  const supabase = await createClient();
  const [m, { data: punches }] = await Promise.all([
    loadMonth(supabase, date.slice(0, 7), { employeeId }),
    supabase
      .from("attendance_punches")
      .select("id, direction, punched_at, source, device_code, reason")
      .eq("employee_id", employeeId)
      .gte("punched_at", `${date}T00:00:00`)
      .lte("punched_at", `${addDays(date, 1)}T12:00:00`)
      .order("punched_at"),
  ]);
  const e = m.employees[0];
  if (!e) notFound();
  const c = m.cells.get(e.id)!.get(date)!;
  const shift = [...m.shifts.values()].find((s) => s.code === c.shiftCode);

  return (
    <>
      <PageHeader
        title={`${e.name} · ${formatDate(date)}`}
        subtitle={`${STATUS[c.status] ?? c.status}${shift ? ` · ${shift.name} ${shift.start_time.slice(0, 5)}–${shift.end_time.slice(0, 5)}` : ""}${c.holidayName ? ` · ${c.holidayName}` : ""}`}
        actions={
          <div className="flex gap-2">
            <Link href={`/puantaj/${employeeId}/${addDays(date, -1)}`} className="h-11 px-3 inline-flex items-center rounded-[10px] border border-[#D5DEE8] bg-white font-semibold text-brand-700">← Önceki gün</Link>
            <Link href={`/puantaj/${employeeId}/${addDays(date, 1)}`} className="h-11 px-3 inline-flex items-center rounded-[10px] border border-[#D5DEE8] bg-white font-semibold text-brand-700">Sonraki gün →</Link>
            <Link href={`/puantaj?donem=${date.slice(0, 7)}`} className="h-11 px-3 inline-flex items-center text-sm font-semibold text-brand-700">Puantaj</Link>
          </div>
        }
      />
      <div className="p-6 md:p-8 flex flex-col gap-5 max-w-4xl">
        <section className="grid gap-3 grid-cols-[repeat(auto-fit,minmax(150px,1fr))]">
          {[
            ["Net çalışma", hhmm(c.workedMin)],
            ["Geç gelme", c.lateMin ? `${c.lateMin} dk` : "—"],
            ["Erken çıkma", c.earlyLeaveMin ? `${c.earlyLeaveMin} dk` : "—"],
            ["Fazla mesai", c.overtimeMin ? `${hhmm(c.overtimeMin)} (×${c.overtimeRate})` : "—"],
          ].map(([l, v]) => (
            <div key={l} className="bg-white border border-line rounded-[14px] px-4 py-3 flex flex-col gap-1">
              <span className="text-xs text-muted">{l}</span>
              <span className="num font-display font-bold text-brand-800">{v}</span>
            </div>
          ))}
        </section>

        <section className="bg-white border border-line rounded-[14px] p-5 flex flex-col gap-3">
          <h2 className="font-display font-semibold text-brand-800">Okutmalar</h2>
          <p className="text-xs text-muted">Gece vardiyası için ertesi gün öğlene kadarki okutmalar da gösterilir.</p>
          <table className="w-full text-sm">
            <tbody>
              {(punches ?? []).map((p) => (
                <tr key={p.id} className="border-b border-[#EEF2F6]">
                  <td className="num py-2 pr-3 font-bold w-28">{p.punched_at.slice(0, 10) !== date ? `${formatDate(p.punched_at).slice(0, 5)} ` : ""}{p.punched_at.slice(11, 16)}</td>
                  <td className="py-2 pr-3"><span className={`text-xs font-bold px-2 py-1 rounded-md ${p.direction === "IN" ? "bg-ok-bg text-ok" : "bg-[#E7F1FB] text-brand-700"}`}>{p.direction === "IN" ? "GİRİŞ" : "ÇIKIŞ"}</span></td>
                  <td className="py-2 pr-3 text-muted text-xs">{p.source === "MANUAL" ? `Manuel · ${p.reason ?? ""}` : p.source === "MOBILE" ? "Mobil" : `Cihaz ${p.device_code ?? ""}`}</td>
                  <td className="py-2 text-right">
                    <form action={deletePunch}>
                      <input type="hidden" name="id" value={p.id} />
                      <ConfirmSubmit label="Sil" question={`${p.punched_at.slice(11, 16)} okutması silinsin mi?`} />
                    </form>
                  </td>
                </tr>
              ))}
              {(punches ?? []).length === 0 && <tr><td className="py-4 text-muted">Okutma yok.</td></tr>}
            </tbody>
          </table>
        </section>

        <section className="bg-white border border-line rounded-[14px] p-5 flex flex-col gap-3">
          <h2 className="font-display font-semibold text-brand-800">Manuel giriş / çıkış ekle</h2>
          <ManualPunchForm employeeId={employeeId} date={date} />
        </section>
      </div>
    </>
  );
}
