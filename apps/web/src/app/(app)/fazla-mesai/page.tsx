import Link from "next/link";
import { formatTL, nextPeriod, overtimeSides, previousPeriod } from "@mb/core";
import { PaySideSelect } from "@/components/PaySideSelect";
import { contractsAt, SIDE_LABEL } from "@/lib/contracts";
import { cumulativeBases } from "@/lib/payroll";
import { Card, PageHeader } from "@/components/ui";
import { ManualOvertimeForm } from "@/components/LeaveOtForms";
import { approveOvertime, cancelOvertime } from "@/lib/leave-ot-actions";
import { createClient } from "@/lib/supabase/server";
import { canManagePay, currentPeriod, formatDate, getSession, periodLabel } from "@/lib/session";
import { hhmm, loadMonth } from "@/lib/timekeeping";
import { overtimeSuggestions } from "@/lib/overtime";
import { LIMITS, shiftNetMinutes } from "@mb/core";
import { ConfirmSubmit, PendingSubmit } from "@/components/ConfirmSubmit";

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
  const year = period.slice(0, 4);
  const [m, { data: records }, { data: yearRecs }, { data: shiftRows }] = await Promise.all([
    loadMonth(supabase, period),
    supabase.from("overtime_records").select("id, employee_id, work_date, minutes, rate, amount, status, source, pay_side, official_gross, official_net, cash_amount").eq("period", period).order("work_date"),
    supabase.from("overtime_records").select("employee_id, minutes, rate, work_date").eq("status", "approved").gte("work_date", `${year}-01-01`).lte("work_date", `${year}-12-31`),
    supabase.from("shifts").select("name, start_time, end_time, crosses_midnight, break_minutes, break_paid, active"),
  ]);
  // Haftalık esasta ay başındaki yarım hafta için önceki ayın puantajı gerekir
  const prev = m.settings.overtimeBasis === "WEEKLY" ? await loadMonth(supabase, previousPeriod(period)) : null;
  const contracts = await contractsAt(supabase, m.employees.map((e) => e.id), `${period}-28`);
  const month = Number(period.slice(5, 7));
  const cum = await cumulativeBases(supabase, period, m.employees.map((e) => ({ id: e.id, hire_date: e.hireDate })), contracts);
  const name = new Map(m.employees.map((e) => [e.id, e.name]));
  const done = new Set((records ?? []).map((r) => `${r.employee_id}|${r.work_date}`));
  const all = overtimeSuggestions(m, prev);
  const suggestions = all.suggestions.filter((x) => !done.has(`${x.employeeId}|${x.date}`));
  // Yıllık 270 saat sınırı: tatil çalışması (×1/×2 ek ücret) fazla mesai sayılmaz
  const yearly = new Map<string, number>();
  for (const r of yearRecs ?? []) if (Number(r.rate) === 1.5) yearly.set(r.employee_id, (yearly.get(r.employee_id) ?? 0) + r.minutes);
  const yearlyWarn = [...yearly.entries()].filter(([, v]) => v > LIMITS.yearlyOvertimeMinutes * 0.85).map(([id, v]) => ({ id, name: name.get(id) ?? "—", minutes: v }));
  const nightWarn = (shiftRows ?? []).filter((sh) => {
    if (!sh.active) return false;
    const st = Number(sh.start_time.slice(0, 2));
    const night = sh.crosses_midnight || st >= 20 || st < 6;
    return night && shiftNetMinutes({ start: sh.start_time.slice(0, 5), end: sh.end_time.slice(0, 5), crossesMidnight: sh.crosses_midnight, breakMinutes: sh.break_minutes, breakPaid: sh.break_paid, lateToleranceMin: 0, earlyToleranceMin: 0, overtimeThresholdMin: 0, weekdays: [] }) > LIMITS.nightWorkMaxMinutes;
  });
  const KIND: Record<string, string> = { WEEK: "Hafta", DAY: "", WEEKLY_OFF: " · HT", HOLIDAY: " · RT", HALF_HOLIDAY: " · Arife" };
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
      <div className="p-4 md:p-8 flex flex-col gap-5 max-w-[1240px]">
        <Card title={`Puantajdan gelen öneriler (${suggestions.length})`}>
          <p className="text-sm text-muted">{m.settings.overtimeBasis === "WEEKLY" ? "Haftalık 45 saati aşan çalışmalar (pazartesi–pazar; haftası bu ay biten haftalar)" : "Vardiya süresini fazla mesai eşiği kadar aşan çalışmalar ile hafta tatili çalışmaları"}{m.settings.overtimeRounding === "HALF_HOUR" ? ", 30 dk altı yarım saate, üstü bir saate yuvarlanır" : ""}. Resmi tatil ve arife (13:00 sonrası) çalışması maaşa ek ×{m.settings.holidayExtraRate} ödenir. Saatlik ücret = aylık / 225. Resmi kısım resmi brüt ücretten hesaplanır ve bordroya brüt girer; elden kısım elden ücretten hesaplanır. Onaylarken hangisinden ödeneceğini seçin.</p>
          {suggestions.length > 0 && (
            <form action={approveOvertime} className="flex flex-col gap-3">
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[760px]">
                  <thead><tr className="text-left text-xs text-muted"><th className={`${th} w-10`}><span className="sr-only">Seç</span></th><th className={th}>Personel</th><th className={th}>Bölüm</th><th className={th}>Tarih</th><th className={`${th} text-right`}>Süre</th><th className={th}>Oran</th>{pay && <><th className={`${th} text-right`}>Resmi brüt</th><th className={`${th} text-right`}>Resmi net etkisi</th><th className={`${th} text-right`}>Elden</th></>}</tr></thead>
                  <tbody>
                    {suggestions.map((x) => (
                      <tr key={`${x.employeeId}|${x.date}`}>
                        <td className={td}><input type="checkbox" name="item" value={`${x.employeeId}|${x.date}|${x.minutes}|${x.rate}`} defaultChecked aria-label={`${x.name} ${x.date}`} className="w-5 h-5 accent-[#0A3D73]" /></td>
                        <td className={`${td} font-semibold`}><Link href={`/puantaj/${x.employeeId}/${x.date}`} className="text-brand-700">{x.name}</Link></td>
                        <td className={td}>{x.dept}</td>
                        <td className={`num ${td}`}>{x.week ? <>{formatDate(x.week.start)} – {formatDate(x.week.end)}<span className="block text-xs text-muted">haftalık {hhmm(x.week.workedMin)}</span></> : <>{formatDate(x.date)}{KIND[x.kind]}</>}</td>
                        <td className={`num ${td} text-right`}>{hhmm(x.minutes)}</td>
                        <td className={td}>×{x.rate}</td>
                        {pay && (() => {
                          const c = contracts.get(x.employeeId);
                          const a = c ? overtimeSides({ contract: c, month, cumulativeTaxBaseBefore: cum.get(x.employeeId) ?? 0 }, x.minutes, x.rate) : null;
                          return a ? (
                            <><td className={`num ${td} text-right`}>{formatTL(a.officialGross)}</td><td className={`num ${td} text-right`}>{formatTL(a.officialNet)}</td><td className={`num ${td} text-right`}>{formatTL(a.cash)}</td></>
                          ) : <td className={`${td} text-muted`} colSpan={3}>Ücret kaydı yok</td>;
                        })()}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex gap-3 items-end flex-wrap">
                <PaySideSelect />
                <PendingSubmit name="decision" value="approve" className="h-11 px-5 rounded-[10px] bg-brand-700 text-white font-semibold">Seçilenleri onayla</PendingSubmit>
                <PendingSubmit name="decision" value="reject" className="h-11 px-5 rounded-[10px] border border-[#D5DEE8] bg-white font-semibold text-bad">Seçilenleri reddet</PendingSubmit>
              </div>
            </form>
          )}
        </Card>

        {(all.warnings.length > 0 || yearlyWarn.length > 0 || nightWarn.length > 0) && (
          <Card title="Yasal sınır uyarıları">
            <ul className="text-sm flex flex-col gap-1.5">
              {nightWarn.map((sh) => <li key={sh.name}>🌙 <b>{sh.name}</b> vardiyası gece çalışması 7,5 saati aşıyor (İş K. 69). Vardiya tanımını gözden geçirin.</li>)}
              {yearlyWarn.map((y) => <li key={y.id}>⏱ <b>{y.name}</b>: {year} yılı onaylı fazla mesai {hhmm(y.minutes)} — yıllık sınır 270 saat{y.minutes > LIMITS.yearlyOvertimeMinutes ? " aşıldı" : "e yaklaşıyor"}.</li>)}
              {all.warnings.filter((w) => w.kind === "LONG_DAY").slice(0, 30).map((w) => <li key={`${w.employeeId}|${w.date}`}>⚠️ <b>{w.name}</b> {formatDate(w.date!)}: günlük çalışma {hhmm(w.minutes)} — günde 11 saati geçemez (İş K. 63).</li>)}
            </ul>
          </Card>
        )}

        <Card title="Manuel fazla mesai">
          <ManualOvertimeForm employees={m.employees.map((e) => ({ id: e.id, name: e.name }))} />
        </Card>

        <Card title={`Kayıtlar (${(records ?? []).length})`}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[700px]">
              <thead><tr className="text-left text-xs text-muted"><th className={th}>Personel</th><th className={th}>Tarih</th><th className={`${th} text-right`}>Süre</th><th className={th}>Oran</th>{pay && <><th className={th}>Ödeme</th><th className={`${th} text-right`}>Cariye yazılan</th></>}<th className={th}>Durum</th><th className={th}><span className="sr-only">İşlem</span></th></tr></thead>
              <tbody>
                {(records ?? []).map((r) => {
                  const [l, cls] = STATUS[r.status] ?? ["", ""];
                  return (
                    <tr key={r.id}>
                      <td className={`${td} font-semibold`}>{name.get(r.employee_id) ?? "—"}</td>
                      <td className={`num ${td}`}>{formatDate(r.work_date)}</td>
                      <td className={`num ${td} text-right`}>{hhmm(r.minutes)}</td>
                      <td className={td}>×{Number(r.rate)}</td>
                      {pay && <><td className={td}>{SIDE_LABEL[r.pay_side] ?? "—"}</td><td className={`num ${td} text-right`}>{r.amount ? formatTL(Number(r.amount)) : "—"}</td></>}
                      <td className={td}><span className={`text-xs font-semibold px-2 py-1 rounded-full ${cls}`}>{l}</span></td>
                      <td className={`${td} text-right`}>
                        <form action={cancelOvertime}><input type="hidden" name="id" value={r.id} /><ConfirmSubmit label="Geri al" question="Fazla mesai ve cari kaydı geri alınsın mı?" className="text-xs font-semibold text-muted" /></form>
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
