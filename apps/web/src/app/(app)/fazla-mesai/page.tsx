import Link from "next/link";
import { formatTL, nextPeriod, overtimePay, previousPeriod } from "@mb/core";
import { Card, PageHeader } from "@/components/ui";
import { ManualOvertimeForm } from "@/components/LeaveOtForms";
import { approveOvertime, cancelOvertime } from "@/lib/leave-ot-actions";
import { createClient } from "@/lib/supabase/server";
import { canManagePay, currentPeriod, formatDate, getSession, periodLabel } from "@/lib/session";
import { hhmm, loadMonth } from "@/lib/timekeeping";

const STATUS: Record<string, [string, string]> = {
  approved: ["Onaylandı", "bg-ok-bg text-ok"],
  rejected: ["Reddedildi", "bg-bad-bg text-bad"],
  pending: ["Bekliyor", "bg-warn-bg text-warn"],
};

export default async function OvertimePage({ searchParams }: { searchParams: Promise<{ donem?: string }> }) {
  const s = await getSession();
  const sp = await searchParams;
  const period = sp.donem && /^\d{4}-\d{2}$/.test(sp.donem) ? sp.donem : currentPeriod();
  const supabase = await createClient();
  const [m, { data: records }, { data: contracts }] = await Promise.all([
    loadMonth(supabase, period),
    supabase.from("overtime_records").select("id, employee_id, work_date, minutes, rate, amount, status, source, ledger_entry_id").eq("period", period).order("work_date"),
    supabase.from("pay_contracts").select("employee_id, valid_from, total_net").order("valid_from"),
  ]);
  const monthly = new Map<string, number>();
  for (const c of contracts ?? []) monthly.set(c.employee_id, Number(c.total_net));
  const name = new Map(m.employees.map((e) => [e.id, e.name]));
  const done = new Set((records ?? []).map((r) => `${r.employee_id}|${r.work_date}`));
  const suggestions = m.employees.flatMap((e) =>
    [...m.cells.get(e.id)!.values()]
      .filter((c) => c.overtimeMin > 0 && !done.has(`${e.id}|${c.date}`))
      .map((c) => ({ employeeId: e.id, name: e.name, dept: e.dept, date: c.date, minutes: c.overtimeMin, rate: c.overtimeRate, status: c.status })),
  );
  const approved = (records ?? []).filter((r) => r.status === "approved");
  const totalMin = approved.reduce((a, r) => a + r.minutes, 0);
  const totalAmt = approved.reduce((a, r) => a + Number(r.amount ?? 0), 0);
  const th = "py-3 px-3 font-semibold border-b border-line";
  const td = "py-2.5 px-3 border-b border-[#EEF2F6]";
  const pay = canManagePay(s.role);

  return (
    <>
      <PageHeader
        title="Fazla mesai"
        subtitle={`${periodLabel(period)} · onaylı ${hhmm(totalMin)}${pay ? ` · ${formatTL(totalAmt)}` : ""}`}
        actions={
          <div className="flex gap-2">
            <Link href={`/fazla-mesai?donem=${previousPeriod(period)}`} className="h-11 px-3 inline-flex items-center rounded-[10px] border border-[#D5DEE8] bg-white font-semibold text-brand-700">←</Link>
            <Link href={`/fazla-mesai?donem=${nextPeriod(period)}`} className="h-11 px-3 inline-flex items-center rounded-[10px] border border-[#D5DEE8] bg-white font-semibold text-brand-700">→</Link>
          </div>
        }
      />
      <div className="p-6 md:p-8 flex flex-col gap-5 max-w-[1240px]">
        <Card title={`Puantajdan gelen öneriler (${suggestions.length})`}>
          <p className="text-sm text-muted">Vardiya süresini fazla mesai eşiği kadar aşan çalışmalar ile hafta tatili / resmi tatil çalışmaları. Onaylanan fazla mesai {pay ? "ücretiyle birlikte dönem hakedişine eklenir" : "kaydedilir"} (saatlik = aylık ücret / 225).</p>
          {suggestions.length > 0 && (
            <form action={approveOvertime} className="flex flex-col gap-3">
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[760px]">
                  <thead><tr className="text-left text-xs text-muted"><th className={`${th} w-10`}><span className="sr-only">Seç</span></th><th className={th}>Personel</th><th className={th}>Bölüm</th><th className={th}>Tarih</th><th className={`${th} text-right`}>Süre</th><th className={th}>Oran</th>{pay && <th className={`${th} text-right`}>Tutar</th>}</tr></thead>
                  <tbody>
                    {suggestions.map((x) => (
                      <tr key={`${x.employeeId}|${x.date}`}>
                        <td className={td}><input type="checkbox" name="item" value={`${x.employeeId}|${x.date}|${x.minutes}|${x.rate}`} defaultChecked aria-label={`${x.name} ${x.date}`} className="w-5 h-5 accent-[#0A3D73]" /></td>
                        <td className={`${td} font-semibold`}><Link href={`/puantaj/${x.employeeId}/${x.date}`} className="text-brand-700">{x.name}</Link></td>
                        <td className={td}>{x.dept}</td>
                        <td className={`num ${td}`}>{formatDate(x.date)}{x.status === "WEEKLY_OFF" ? " · HT" : x.status === "HOLIDAY" ? " · RT" : ""}</td>
                        <td className={`num ${td} text-right`}>{hhmm(x.minutes)}</td>
                        <td className={td}>×{x.rate}</td>
                        {pay && <td className={`num ${td} text-right`}>{monthly.has(x.employeeId) ? formatTL(overtimePay(monthly.get(x.employeeId)!, x.minutes, x.rate)) : "—"}</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex gap-3">
                <button name="decision" value="approve" className="h-11 px-5 rounded-[10px] bg-brand-700 text-white font-semibold">Seçilenleri onayla</button>
                <button name="decision" value="reject" className="h-11 px-5 rounded-[10px] border border-[#D5DEE8] bg-white font-semibold text-bad">Seçilenleri reddet</button>
              </div>
            </form>
          )}
        </Card>

        <Card title="Manuel fazla mesai">
          <ManualOvertimeForm employees={m.employees.map((e) => ({ id: e.id, name: e.name }))} />
        </Card>

        <Card title={`Kayıtlar (${(records ?? []).length})`}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[700px]">
              <thead><tr className="text-left text-xs text-muted"><th className={th}>Personel</th><th className={th}>Tarih</th><th className={`${th} text-right`}>Süre</th><th className={th}>Oran</th>{pay && <th className={`${th} text-right`}>Tutar</th>}<th className={th}>Durum</th><th className={th}><span className="sr-only">İşlem</span></th></tr></thead>
              <tbody>
                {(records ?? []).map((r) => {
                  const [l, cls] = STATUS[r.status] ?? ["", ""];
                  return (
                    <tr key={r.id}>
                      <td className={`${td} font-semibold`}>{name.get(r.employee_id) ?? "—"}</td>
                      <td className={`num ${td}`}>{formatDate(r.work_date)}</td>
                      <td className={`num ${td} text-right`}>{hhmm(r.minutes)}</td>
                      <td className={td}>×{Number(r.rate)}</td>
                      {pay && <td className={`num ${td} text-right`}>{r.amount ? formatTL(Number(r.amount)) : "—"}</td>}
                      <td className={td}><span className={`text-xs font-semibold px-2 py-1 rounded-full ${cls}`}>{l}</span></td>
                      <td className={`${td} text-right`}>
                        <form action={cancelOvertime}><input type="hidden" name="id" value={r.id} /><button className="text-xs font-semibold text-muted">Geri al</button></form>
                      </td>
                    </tr>
                  );
                })}
                {(records ?? []).length === 0 && <tr><td colSpan={7} className="py-6 text-center text-muted">Kayıt yok.</td></tr>}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </>
  );
}
