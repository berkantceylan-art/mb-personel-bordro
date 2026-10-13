import Link from "next/link";
import { redirect } from "next/navigation";
import { formatTL, periodBounds } from "@mb/core";
import { PageHeader } from "@/components/ui";
import { LeaveForm, ManualOvertimeForm } from "@/components/LeaveOtForms";
import { BesForm, GarnishmentForm } from "@/components/BesIcraForms";
import { ConfirmSubmit } from "@/components/ConfirmSubmit";
import { computePayroll } from "@/lib/payroll";
import { createClient } from "@/lib/supabase/server";
import { canManagePay, currentPeriod, getSession, periodLabel } from "@/lib/session";
import { loadMonth } from "@/lib/timekeeping";
import { decideLeave, cancelOvertime } from "@/lib/leave-ot-actions";
import { setBesStatus, setGarnishmentStatus } from "@/lib/bes-icra-actions";
import { wizApprove, wizVoid } from "@/lib/wizard-actions";
import { AdvanceForm, BonusForm, MissingForm } from "./WizForms";

const STEPS = ["Puantaj", "Fazla mesai ve prim", "BES", "İcra / nafaka", "Avanslar", "Özet ve onay"] as const;
const DOW = ["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"];
const dt = (d: string) => d.split("-").reverse().join(".");
const btn = "h-11 px-4 inline-flex items-center rounded-[10px] border border-[#D5DEE8] bg-white font-semibold text-brand-700";
const small = "h-8 px-3 rounded-lg border border-[#D5DEE8] text-xs font-semibold text-[#33414F] bg-white";
const LEAVE_CLS: Record<string, string> = { RAPOR: "bg-[#FDECEA] text-bad", UCRETSIZ: "bg-[#FFF4E0] text-warn", YILLIK: "bg-[#E6F4EC] text-ok" };

export default async function PayrollWizardPage({ searchParams }: { searchParams: Promise<{ donem?: string; p?: string; adim?: string; tamam?: string; hata?: string; bitti?: string }> }) {
  const s = await getSession();
  if (!canManagePay(s.role)) redirect("/");
  const sp = await searchParams;
  const period = sp.donem && /^\d{4}-\d{2}$/.test(sp.donem) ? sp.donem : currentPeriod();
  const { start, end } = periodBounds(period);
  const step = Math.min(6, Math.max(1, Number(sp.adim) || 1));
  const supabase = await createClient();

  const [{ data: emps }, { data: lines }] = await Promise.all([
    supabase.from("employees").select("id, first_name, last_name, departments(name)").lte("hire_date", end).or(`termination_date.is.null,termination_date.gte.${start}`).order("first_name"),
    supabase.from("payroll_lines").select("employee_id, posted").eq("period", period),
  ]);
  const list = (emps ?? []).map((e) => ({ id: e.id, name: `${e.first_name} ${e.last_name}`, dept: (e.departments as unknown as { name: string } | null)?.name ?? "Bölümsüz" }))
    .sort((a, b) => a.dept.localeCompare(b.dept, "tr") || a.name.localeCompare(b.name, "tr"));
  if (!list.length) {
    return (<><PageHeader title="Bordro sihirbazı" subtitle={periodLabel(period)} /><p className="p-6 text-muted">Bu dönemde personel yok.</p></>);
  }
  const savedBy = new Map((lines ?? []).map((l) => [l.employee_id, l.posted as boolean]));
  const idx = Math.max(0, list.findIndex((e) => e.id === sp.p));
  const emp = list[idx]!;
  const prevEmp = list[idx - 1];
  const nextEmp = list[idx + 1];
  const nextUnsaved = list.slice(idx + 1).find((e) => !savedBy.has(e.id)) ?? nextEmp;

  const [rows, month, { data: leaves }, { data: leaveTypes }, { data: ots }, { data: entries }, { data: bes }, { data: files }, { data: accRows }] = await Promise.all([
    computePayroll(supabase, period, { employeeId: emp.id }),
    loadMonth(supabase, period, { employeeId: emp.id }),
    supabase.from("leave_requests").select("id, start_date, end_date, days, status, leave_types(name, code)").eq("employee_id", emp.id).in("status", ["approved", "pending"]).lte("start_date", end).gte("end_date", start).order("start_date"),
    supabase.from("leave_types").select("id, name, code, sort_order").order("sort_order"),
    supabase.from("overtime_records").select("id, work_date, minutes, rate, status, pay_side, official_gross, official_net, cash_amount").eq("employee_id", emp.id).eq("period", period).order("work_date"),
    supabase.from("ledger_entries").select("id, entry_date, type, channel, amount, pay_side, gross_amount, days, note, account_id").eq("employee_id", emp.id).eq("period", period).is("voided_at", null).order("entry_date"),
    supabase.from("bes_enrollments").select("id, enrolled_on, rate, status, status_date, policy_no").eq("employee_id", emp.id).order("enrolled_on", { ascending: false }),
    supabase.from("garnishment_balances").select("id, kind, office, file_no, creditor, served_at, debt_amount, monthly_amount, paid, remaining, status").eq("employee_id", emp.id).order("served_at"),
    supabase.from("fin_accounts").select("id, name, kind").in("kind", ["bank", "cash"]).eq("is_active", true).eq("currency", "TRY").order("sort").order("name"),
  ]);
  const row = rows[0];
  const accounts = (accRows ?? []).map((a) => ({ id: a.id, name: a.name, kind: a.kind as "bank" | "cash" }));
  const accName = new Map(accounts.map((a) => [a.id, a.name]));
  const b = row?.result.breakdown;
  const posted = row?.saved?.posted ?? false;
  const q = (o: Record<string, string | number>) => `/bordro/sihirbaz?${new URLSearchParams({ donem: period, p: emp.id, adim: String(step), ...Object.fromEntries(Object.entries(o).map(([k, v]) => [k, String(v)])) }).toString()}`;

  // Puantaj özeti
  const cells = [...(month.cells.get(emp.id)?.values() ?? [])];
  let worked = 0, absent = 0, sick = 0, unpaid = 0, paidLeave = 0, off = 0, incomplete = 0;
  for (const c of cells) {
    if (!c.employed) continue;
    if (c.status === "WORKED") worked++;
    else if (c.status === "ABSENT") absent++;
    else if (c.status === "INCOMPLETE") incomplete++;
    else if (c.leaveCode === "RAPOR") sick++;
    else if (c.leaveCode === "UCRETSIZ") unpaid++;
    else if (c.status === "LEAVE") paidLeave++;
    else off++;
  }
  const missingDays = Math.min(30, absent + sick + unpaid);
  const written = (entries ?? []).filter((e) => e.type === "DEDUCTION" && (e.note ?? "").startsWith("Eksik gün"));
  const writtenOfficialDays = written.filter((e) => e.pay_side === "OFFICIAL").reduce((a, e) => a + Number(e.days ?? 0), 0);
  const missingOk = missingDays === 0 ? written.length === 0 : written.length > 0 && writtenOfficialDays >= sick;
  const firstDow = (new Date(start + "T00:00:00Z").getUTCDay() + 6) % 7;

  const bonuses = (entries ?? []).filter((e) => e.type === "BONUS");
  const advances = (entries ?? []).filter((e) => e.type === "ADVANCE");
  const salaries = (entries ?? []).filter((e) => e.type === "SALARY");
  const activeBes = (bes ?? []).find((x) => x.status === "active");
  const garnThisMonth = new Map((row?.result.garnishments ?? []).map((g) => [g.fileId, g.amount]));
  const counts = [missingDays ? `${missingDays} eksik gün` : "tam ay", (ots ?? []).length + bonuses.length ? `${(ots ?? []).length + bonuses.length} kalem` : "yok", activeBes ? `%${Math.round(Number(activeBes.rate) * 100)}` : "yok", (files ?? []).filter((f) => f.status === "active").length ? `${(files ?? []).filter((f) => f.status === "active").length} dosya` : "yok", advances.length ? `${advances.length} avans` : "yok", savedBy.has(emp.id) ? "kaydedildi" : "bekliyor"];
  const savedCount = list.filter((e) => savedBy.has(e.id)).length;
  const td = "py-2 px-3 border-b border-[#EEF2F6]";

  return (
    <>
      <PageHeader
        title={`Bordro sihirbazı · ${periodLabel(period)}`}
        subtitle={`${savedCount}/${list.length} personelin bordrosu kaydedildi`}
        actions={
          <div className="flex gap-2 flex-wrap">
            <Link href={`/donemler/${period}`} className={btn}>Maaş planı</Link>
            <Link href={`/bordro?donem=${period}`} className={btn}>Bordro listesi</Link>
          </div>
        }
      />
      <div className="p-4 md:p-6 grid gap-5 lg:grid-cols-[280px_1fr] items-start">
        {/* Personel listesi */}
        <aside className="bg-white border border-line rounded-[14px] p-3 flex flex-col gap-1 lg:sticky lg:top-4 lg:max-h-[calc(100vh-120px)] overflow-auto">
          <form className="flex gap-2 mb-2" action="/bordro/sihirbaz">
            <input type="hidden" name="donem" value={period} />
            <select name="p" defaultValue={emp.id} aria-label="Personel seç" className="flex-1 h-10 rounded-lg border border-[#D5DEE8] bg-white px-2 text-sm">
              {list.map((e) => <option key={e.id} value={e.id}>{savedBy.has(e.id) ? "✓ " : ""}{e.name}</option>)}
            </select>
            <button className="h-10 px-3 rounded-lg bg-brand-700 text-white text-sm font-semibold">Git</button>
          </form>
          {list.map((e) => (
            <Link key={e.id} href={`/bordro/sihirbaz?donem=${period}&p=${e.id}&adim=${step}`} className={`flex items-center gap-2 px-2.5 py-2 rounded-lg text-sm ${e.id === emp.id ? "bg-brand-700 text-white font-semibold" : "hover:bg-[#F3F6F9]"}`}>
              <span className={`w-5 h-5 rounded-full grid place-items-center text-[11px] shrink-0 ${savedBy.has(e.id) ? "bg-ok text-white" : e.id === emp.id ? "bg-white/30" : "bg-[#E3E9F0] text-muted"}`} aria-hidden>{savedBy.has(e.id) ? "✓" : ""}</span>
              <span className="flex-1 min-w-0 truncate">{e.name}</span>
              <span className={`text-[11px] ${e.id === emp.id ? "text-white/80" : "text-muted"}`}>{e.dept}</span>
            </Link>
          ))}
        </aside>

        <div className="flex flex-col gap-4 min-w-0">
          {sp.tamam && <p role="status" className="text-sm rounded-[12px] px-4 py-2.5 bg-ok-bg text-ok">{list.find((e) => e.id === sp.tamam)?.name ?? "Personel"} bordrosu kaydedildi. Sıradaki: {emp.name}.</p>}
          {sp.bitti && <p role="status" className="text-sm rounded-[12px] px-4 py-2.5 bg-ok-bg text-ok">Son personelin bordrosu da kaydedildi. Ödemeler için <Link href={`/donemler/${period}`} className="font-semibold underline">maaş planına</Link> geçin.</p>}
          {sp.hata && <p role="alert" className="text-sm rounded-[12px] px-4 py-2.5 bg-bad-bg text-bad">Kaydedilemedi: {sp.hata}</p>}

          {/* Personel kartı ve canlı rakamlar */}
          <section className="bg-white border border-line rounded-[14px] p-4 flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex-1 min-w-0">
                <h2 className="font-display text-xl font-bold text-brand-800">{emp.name}</h2>
                <p className="text-sm text-muted">{emp.dept} · {idx + 1}/{list.length}{row ? ` · ${row.insurance === "NONE" ? "SİGORTASIZ (tamamı elden)" : row.insurance === "MIN_WAGE" ? "asgari ücretli" : "belirli resmi net"} · anlaşılan ${formatTL(row.totalNet)}` : " · ücret kaydı yok"}{posted ? " · kesintiler cariye yazılı (kilitli)" : ""}</p>
              </div>
              <div className="flex gap-2">
                {prevEmp && <Link href={`/bordro/sihirbaz?donem=${period}&p=${prevEmp.id}&adim=${step}`} className={btn} aria-label="Önceki personel">← {prevEmp.name.split(" ")[0]}</Link>}
                {nextEmp && <Link href={`/bordro/sihirbaz?donem=${period}&p=${nextEmp.id}&adim=${step}`} className={btn} aria-label="Sonraki personel">{nextEmp.name.split(" ")[0]} →</Link>}
                <Link href={`/personel/${emp.id}?donem=${period}`} className={btn}>Kart</Link>
              </div>
            </div>
            {row && b ? (
              <div className="grid gap-2 grid-cols-2 sm:grid-cols-4 xl:grid-cols-8 text-center">
                {([
                  ["Gün", String(row.result.days)],
                  ["Resmi brüt", formatTL(b.gross)],
                  ["Resmi net", formatTL(b.net)],
                  ["BES", b.bes ? formatTL(b.bes) : "—"],
                  ["İcra", row.result.garnishmentTotal ? formatTL(row.result.garnishmentTotal) : "—"],
                  ["Bankaya", formatTL(row.result.netToBank)],
                  ["Kalan banka", formatTL(row.pay.bank)],
                  ["Kalan elden", formatTL(row.pay.cash)],
                ] as const).map(([k, v]) => (
                  <div key={k} className="rounded-[10px] bg-[#F5F8FB] px-2 py-2">
                    <div className="text-[11px] text-muted">{k}</div>
                    <div className="num font-bold text-brand-800 text-sm">{v}</div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-warn">Bu personelin ücret kaydı yok; <Link href={`/personel/${emp.id}`} className="underline font-semibold">personel kartından</Link> sözleşme ekleyin.</p>
            )}
          </section>

          {/* Adımlar */}
          <nav className="flex gap-1 overflow-x-auto" aria-label="Sihirbaz adımları">
            {STEPS.map((t, i) => (
              <Link key={t} href={q({ adim: i + 1 })} aria-current={step === i + 1 ? "step" : undefined}
                className={`shrink-0 flex flex-col px-3 py-2 rounded-[10px] text-sm border ${step === i + 1 ? "bg-brand-700 text-white border-brand-700" : "bg-white border-line text-[#33414F]"}`}>
                <span className="font-semibold">{i + 1}. {t}</span>
                <span className={`text-[11px] ${step === i + 1 ? "text-white/80" : "text-muted"}`}>{counts[i]}</span>
              </Link>
            ))}
          </nav>

          <section className="bg-white border border-line rounded-[14px] p-4 md:p-5 flex flex-col gap-4">
            {step === 1 && (
              <>
                <div className="flex flex-wrap gap-2 text-xs">
                  {[["Çalıştı", worked, "bg-[#E6F4EC] text-ok"], ["İzinli (ücretli)", paidLeave, "bg-[#EAF2FB] text-brand-700"], ["Rapor", sick, "bg-[#FDECEA] text-bad"], ["Ücretsiz izin", unpaid, "bg-[#FFF4E0] text-warn"], ["Devamsız", absent, "bg-bad text-white"], ["Eksik okutma", incomplete, "bg-warn text-white"], ["Tatil / hafta sonu", off, "bg-[#EEF2F6] text-muted"]].map(([l, n, c]) => (
                    <span key={l as string} className={`px-2.5 py-1 rounded-full font-semibold ${c}`}>{l}: {n as number}</span>
                  ))}
                </div>
                <div className="grid grid-cols-7 gap-1 text-center text-xs">
                  {DOW.map((d) => <div key={d} className="text-muted font-semibold py-1">{d}</div>)}
                  {Array.from({ length: firstDow }).map((_, i) => <div key={`e${i}`} />)}
                  {month.days.map((d) => {
                    const c = month.cells.get(emp.id)?.get(d);
                    const cls = !c || !c.employed ? "bg-[#F7F9FB] text-[#B8C2CC]"
                      : c.leaveCode ? LEAVE_CLS[c.leaveCode] ?? "bg-[#EAF2FB] text-brand-700"
                      : c.status === "WORKED" ? "bg-[#E6F4EC] text-ok"
                      : c.status === "ABSENT" ? "bg-bad text-white"
                      : c.status === "INCOMPLETE" ? "bg-warn text-white"
                      : "bg-[#EEF2F6] text-muted";
                    const label = !c ? "" : c.leaveCode ? c.leaveCode === "RAPOR" ? "Rapor" : c.leaveCode === "UCRETSIZ" ? "Ücrets." : "İzin" : c.status === "WORKED" ? `${Math.floor(c.workedMin / 60)}s${c.workedMin % 60 ? String(c.workedMin % 60).padStart(2, "0") : ""}` : c.status === "ABSENT" ? "Yok" : c.status === "INCOMPLETE" ? "Eksik" : c.holidayName ? "Tatil" : "—";
                    return (
                      <Link key={d} href={`/puantaj/${emp.id}/${d}`} className={`rounded-lg py-1.5 min-h-12 flex flex-col items-center justify-center ${cls}`} title={c?.holidayName ?? undefined}>
                        <span className="font-bold">{Number(d.slice(8))}</span>
                        <span className="text-[10px]">{label}</span>
                      </Link>
                    );
                  })}
                </div>
                <p className="text-xs text-muted">Bir güne tıklayınca giriş-çıkış kayıtlarını düzeltebilirsiniz. Rapor ve izin günlerini aşağıdan girin.</p>

                <div className={`rounded-[12px] p-3 flex flex-col gap-2 ${missingOk ? "bg-ok-bg" : "bg-warn-bg"}`}>
                  <p className={`text-sm font-semibold ${missingOk ? "text-ok" : "text-warn"}`}>
                    {missingDays === 0 && written.length === 0 ? "Eksik gün yok; hakediş tam ay." : missingOk ? `Eksik günler hakedişe yansıtıldı (${written.map((w) => `${w.pay_side === "OFFICIAL" ? "resmi" : "elden"} ${formatTL(Number(w.amount))}`).join(" · ")}).` : `${missingDays} eksik gün (rapor ${sick}, devamsız ${absent}, ücretsiz ${unpaid}) henüz hakedişe yansımadı ya da puantaj değişti.`}
                  </p>
                  {!posted && (missingDays > 0 || written.length > 0) && <MissingForm employeeId={emp.id} period={period} label={written.length ? "Yeniden hesapla" : "Eksik günleri yansıt"} />}
                  <p className="text-xs text-muted">Rapor günleri hem resmi hem elden kısımdan günlük ücret kadar kesilir.</p>
                </div>

                {(leaves ?? []).length > 0 && (
                  <div className="flex flex-col gap-1">
                    <h3 className="text-sm font-semibold text-brand-800">Bu ayki izin ve raporlar</h3>
                    <ul className="flex flex-col">
                      {(leaves ?? []).map((l) => {
                        const t = l.leave_types as unknown as { name: string; code: string } | null;
                        return (
                          <li key={l.id} className="flex flex-wrap items-center gap-3 py-1.5 border-b border-[#EEF2F6] text-sm">
                            <span className={`px-2 py-0.5 rounded-md text-xs font-semibold ${LEAVE_CLS[t?.code ?? ""] ?? "bg-[#EAF2FB] text-brand-700"}`}>{t?.name ?? "İzin"}</span>
                            <span className="num">{dt(l.start_date)}{l.end_date !== l.start_date ? ` – ${dt(l.end_date)}` : ""} · {Number(l.days)} gün</span>
                            {l.status === "pending" && <span className="text-xs text-warn font-semibold">onay bekliyor</span>}
                            {l.status === "approved" && (
                              <form action={decideLeave} className="ml-auto">
                                <input type="hidden" name="id" value={l.id} />
                                <input type="hidden" name="status" value="cancelled" />
                                <ConfirmSubmit label="İptal" question="İzin / rapor iptal edilsin mi?" className={small} />
                              </form>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}
                <details className="rounded-[12px] border border-line p-3">
                  <summary className="cursor-pointer font-semibold text-brand-700 text-sm">+ Rapor / izin gir</summary>
                  <div className="mt-3">
                    <LeaveForm employees={[{ id: emp.id, name: emp.name }]} defaultEmployee={emp.id} types={(leaveTypes ?? []).map((t) => ({ id: t.id, name: t.name, code: t.code }))} />
                  </div>
                </details>
              </>
            )}

            {step === 2 && (
              <>
                <div className="flex flex-col gap-2">
                  <h3 className="font-semibold text-brand-800">Fazla mesai</h3>
                  {(ots ?? []).length ? (
                    <table className="w-full text-[13px]">
                      <thead><tr className="text-left text-xs text-muted"><th className={td}>Tarih</th><th className={td}>Süre</th><th className={td}>Oran</th><th className={td}>Durum</th><th className={`${td} text-right`}>Resmi net</th><th className={`${td} text-right`}>Elden</th><th className={td} /></tr></thead>
                      <tbody>
                        {(ots ?? []).map((o) => (
                          <tr key={o.id}>
                            <td className={`${td} num`}>{dt(o.work_date)}</td>
                            <td className={`${td} num`}>{Math.floor(o.minutes / 60)} sa {o.minutes % 60 ? `${o.minutes % 60} dk` : ""}</td>
                            <td className={td}>×{Number(o.rate)}</td>
                            <td className={td}>{o.status === "approved" ? <span className="text-ok font-semibold text-xs">onaylı</span> : o.status === "pending" ? <span className="text-warn text-xs font-semibold">bekliyor</span> : <span className="text-muted text-xs">{o.status}</span>}</td>
                            <td className={`${td} num text-right`}>{o.official_net ? formatTL(Number(o.official_net)) : "—"}</td>
                            <td className={`${td} num text-right`}>{o.cash_amount ? formatTL(Number(o.cash_amount)) : "—"}</td>
                            <td className={`${td} text-right`}>
                              <form action={cancelOvertime}><input type="hidden" name="id" value={o.id} /><ConfirmSubmit label="Sil" question="Fazla mesai kaydı silinsin mi?" className={small} /></form>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : <p className="text-sm text-muted">Bu ay fazla mesai kaydı yok. Puantajdan çıkan öneriler <Link href={`/fazla-mesai?donem=${period}`} className="font-semibold text-brand-700">Fazla mesai</Link> sayfasında onaylanır.</p>}
                  <ManualOvertimeForm employees={[{ id: emp.id, name: emp.name }]} defaultEmployee={emp.id} />
                </div>
                <div className="flex flex-col gap-2 border-t border-line pt-4">
                  <h3 className="font-semibold text-brand-800">Prim / ikramiye</h3>
                  {bonuses.length > 0 && (
                    <ul>
                      {bonuses.map((e) => (
                        <li key={e.id} className="flex flex-wrap items-center gap-3 py-1.5 border-b border-[#EEF2F6] text-sm">
                          <span className="flex-1">{e.note ?? "Prim"}</span>
                          {e.gross_amount ? <span className="text-xs text-muted">brüt {formatTL(Number(e.gross_amount))}</span> : null}
                          <span className="num font-semibold">{formatTL(Number(e.amount))}</span>
                          {!posted && <form action={wizVoid}><input type="hidden" name="id" value={e.id} /><ConfirmSubmit label="Geri al" question="Prim geri alınsın mı?" className={small} /></form>}
                        </li>
                      ))}
                    </ul>
                  )}
                  <BonusForm employeeId={emp.id} period={period} />
                </div>
              </>
            )}

            {step === 3 && (
              <>
                {(bes ?? []).length ? (
                  <ul>
                    {(bes ?? []).map((x) => (
                      <li key={x.id} className="flex flex-wrap items-center gap-3 py-2 border-b border-[#EEF2F6] text-sm">
                        <span className="font-semibold">%{Math.round(Number(x.rate) * 1000) / 10}</span>
                        <span className="text-muted">giriş {dt(x.enrolled_on)}{x.policy_no ? ` · poliçe ${x.policy_no}` : ""}</span>
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-md ${x.status === "active" ? "bg-ok-bg text-ok" : "bg-[#EEF2F6] text-muted"}`}>{({ active: "aktif", opted_out: "cayma", paused: "ara verdi", left: "ayrıldı" } as Record<string, string>)[x.status] ?? x.status}{x.status_date && x.status !== "active" ? ` · ${dt(x.status_date)}` : ""}</span>
                        <div className="ml-auto flex gap-1.5">
                          {(x.status === "active" ? [["paused", "Ara ver"], ["opted_out", "Cayma"], ["left", "Ayrıldı"]] : [["active", "Yeniden başlat"]]).map(([st, l]) => (
                            <form key={st} action={setBesStatus}><input type="hidden" name="id" value={x.id} /><input type="hidden" name="status" value={st} /><button className={small}>{l}</button></form>
                          ))}
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : <p className="text-sm text-muted">BES kaydı yok.</p>}
                <p className="text-sm">Bu ay kesilecek BES: <b className="num">{b ? formatTL(b.bes) : "—"}</b> <span className="text-xs text-muted">(prime esas kazancın %{activeBes ? Math.round(Number(activeBes.rate) * 1000) / 10 : 0}&apos;i)</span></p>
                {!activeBes && (
                  <details className="rounded-[12px] border border-line p-3">
                    <summary className="cursor-pointer font-semibold text-brand-700 text-sm">+ BES kaydı ekle</summary>
                    <div className="mt-3"><BesForm employees={[{ id: emp.id, name: emp.name }]} defaultEmployee={emp.id} /></div>
                  </details>
                )}
              </>
            )}

            {step === 4 && (
              <>
                {(files ?? []).length ? (
                  <table className="w-full text-[13px]">
                    <thead><tr className="text-left text-xs text-muted"><th className={td}>Dosya</th><th className={td}>Tebliğ</th><th className={`${td} text-right`}>Borç / aylık</th><th className={`${td} text-right`}>Kesilen</th><th className={`${td} text-right`}>Kalan</th><th className={`${td} text-right`}>Bu ay</th><th className={td} /></tr></thead>
                    <tbody>
                      {(files ?? []).map((f) => (
                        <tr key={f.id}>
                          <td className={td}><span className="font-semibold">{f.kind === "ALIMONY" ? "Nafaka" : "İcra"} · {f.office}</span><span className="block text-xs text-muted">{f.file_no}{f.creditor ? ` · ${f.creditor}` : ""}{f.status !== "active" ? ` · ${f.status === "closed" ? "kapandı" : "durduruldu"}` : ""}</span></td>
                          <td className={`${td} num`}>{dt(f.served_at)}</td>
                          <td className={`${td} num text-right`}>{f.kind === "ALIMONY" ? `${formatTL(Number(f.monthly_amount))}/ay` : formatTL(Number(f.debt_amount))}</td>
                          <td className={`${td} num text-right`}>{formatTL(Number(f.paid))}</td>
                          <td className={`${td} num text-right`}>{f.remaining === null ? "—" : formatTL(Number(f.remaining))}</td>
                          <td className={`${td} num text-right font-semibold`}>{garnThisMonth.get(f.id) ? formatTL(garnThisMonth.get(f.id)!) : "—"}</td>
                          <td className={`${td} text-right`}>
                            <div className="flex gap-1.5 justify-end">
                              {(f.status === "active" ? [["suspended", "Durdur"], ["closed", "Kapat"]] : [["active", "Aktif et"]]).map(([st, l]) => (
                                <form key={st} action={setGarnishmentStatus}><input type="hidden" name="id" value={f.id} /><input type="hidden" name="status" value={st} /><button className={small}>{l}</button></form>
                              ))}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : <p className="text-sm text-muted">İcra / nafaka dosyası yok.</p>}
                <p className="text-xs text-muted">Nafaka tam kesilir; icra dosyaları tebliğ sırasıyla resmi netin 1/4&apos;ünden karşılanır.</p>
                <details className="rounded-[12px] border border-line p-3">
                  <summary className="cursor-pointer font-semibold text-brand-700 text-sm">+ Dosya ekle</summary>
                  <div className="mt-3"><GarnishmentForm employees={[{ id: emp.id, name: emp.name }]} defaultEmployee={emp.id} /></div>
                </details>
              </>
            )}

            {step === 5 && (
              <>
                {advances.length || salaries.length ? (
                  <ul>
                    {[...advances, ...salaries].map((e) => (
                      <li key={e.id} className="flex flex-wrap items-center gap-3 py-1.5 border-b border-[#EEF2F6] text-sm">
                        <span className="num">{dt(e.entry_date)}</span>
                        <span className="font-semibold">{e.type === "ADVANCE" ? "Avans" : "Maaş ödemesi"}</span>
                        <span className="text-muted">{e.channel === "BANK" ? "banka" : "elden"}{e.account_id ? ` · ${accName.get(e.account_id) ?? ""}` : ""}</span>
                        <span className="num font-semibold ml-auto">{formatTL(Number(e.amount))}</span>
                        <form action={wizVoid}><input type="hidden" name="id" value={e.id} /><ConfirmSubmit label="Geri al" question="Ödeme geri alınsın mı? Kasa / banka hareketi de iptal olur." className={small} /></form>
                      </li>
                    ))}
                  </ul>
                ) : <p className="text-sm text-muted">Bu ay avans yok.</p>}
                {accounts.length ? <AdvanceForm employeeId={emp.id} period={period} today={new Date().toISOString().slice(0, 10)} accounts={accounts} /> : <p className="text-sm text-warn">Avans için Finans&apos;ta TL kasa / banka tanımlayın.</p>}
              </>
            )}

            {step === 6 && row && b && (
              <div className="grid gap-4 md:grid-cols-2">
                <div className="flex flex-col gap-1">
                  <h3 className="font-semibold text-brand-800">Resmi bordro</h3>
                  <table className="w-full text-sm">
                    <tbody>
                      {([
                        ["Bordro günü", String(row.result.days)],
                        ["Brüt (gün)", formatTL(row.result.dayGross)],
                        ...(row.result.overtimeGross ? [["Fazla mesai brütü", formatTL(row.result.overtimeGross)]] : []),
                        ...(row.result.bonusGross ? [["Prim brütü", formatTL(row.result.bonusGross)]] : []),
                        ["Toplam brüt", formatTL(b.gross)],
                        ["SGK işçi + işsizlik", `−${formatTL(b.sgkEmployee + b.unemploymentEmployee)}`],
                        ["Gelir vergisi", `−${formatTL(b.incomeTax)}${b.incomeTaxExemption ? ` (istisna ${formatTL(b.incomeTaxExemption)})` : ""}`],
                        ["Damga vergisi", `−${formatTL(b.stampTax)}`],
                        ["Resmi net", formatTL(b.net)],
                        ["BES", b.bes ? `−${formatTL(b.bes)}` : "—"],
                        ["İcra / nafaka", row.result.garnishmentTotal ? `−${formatTL(row.result.garnishmentTotal)}` : "—"],
                        ["Bankaya yatacak", formatTL(row.result.netToBank)],
                        ["İşveren maliyeti", formatTL(b.employerCost)],
                      ] as Array<[string, string]>).map(([k, v]) => (
                        <tr key={k} className={k === "Resmi net" || k === "Bankaya yatacak" ? "font-bold" : ""}><td className="py-1.5 border-b border-[#EEF2F6] text-muted">{k}</td><td className="num py-1.5 border-b border-[#EEF2F6] text-right">{v}</td></tr>
                      ))}
                    </tbody>
                  </table>
                  {row.cumulativeEstimated && <p className="text-xs text-warn">Gelir vergisi matrahı tahmini (önceki aylarda kayıtlı bordro yok).</p>}
                </div>
                <div className="flex flex-col gap-1">
                  <h3 className="font-semibold text-brand-800">Toplam maaş (resmi + elden)</h3>
                  <table className="w-full text-sm">
                    <tbody>
                      {([
                        ["Anlaşılan aylık", formatTL(row.totalNet)],
                        ["Hakediş (prim, fazla mesai dahil)", formatTL(row.ledger.accrued)],
                        ["Eksik gün kesintisi", (row.ledger.absenceOfficial + row.ledger.absenceCash) ? `−${formatTL(row.ledger.absenceOfficial + row.ledger.absenceCash)}` : "—"],
                        ["BES + icra", (b.bes + row.result.garnishmentTotal) ? `−${formatTL(b.bes + row.result.garnishmentTotal)}` : "—"],
                        ["Avans / ödenen (banka)", row.ledger.paidBank ? `−${formatTL(row.ledger.paidBank)}` : "—"],
                        ["Avans / ödenen (elden)", row.ledger.paidCash ? `−${formatTL(row.ledger.paidCash)}` : "—"],
                        ["Kalan → bankaya", formatTL(row.pay.bank)],
                        ["Kalan → elden", formatTL(row.pay.cash)],
                      ] as Array<[string, string]>).map(([k, v]) => (
                        <tr key={k} className={k.startsWith("Kalan") ? "font-bold text-brand-800" : ""}><td className="py-1.5 border-b border-[#EEF2F6] text-muted">{k}</td><td className="num py-1.5 border-b border-[#EEF2F6] text-right">{v}</td></tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="flex gap-3 text-sm mt-1">
                    <a href={`/yazdir/bordro/${period}?tur=resmi&personel=${emp.id}`} target="_blank" className="font-semibold text-brand-700">Resmi bordro PDF</a>
                    <a href={`/yazdir/bordro/${period}?tur=ic&personel=${emp.id}`} target="_blank" className="font-semibold text-brand-700">İç hakediş fişi</a>
                  </div>
                </div>
              </div>
            )}

            {/* Alt gezinme */}
            <div className="flex flex-wrap gap-2 items-center border-t border-line pt-4">
              {step > 1 && <Link href={q({ adim: step - 1 })} className={btn}>← {STEPS[step - 2]}</Link>}
              <div className="ml-auto flex gap-2 flex-wrap">
                {step < 6 && <Link href={q({ adim: step + 1 })} className="h-11 px-5 inline-flex items-center rounded-[10px] bg-brand-700 text-white font-semibold">{STEPS[step]} →</Link>}
                {step === 6 && row && !posted && (
                  <form action={wizApprove}>
                    <input type="hidden" name="employeeId" value={emp.id} />
                    <input type="hidden" name="period" value={period} />
                    <input type="hidden" name="next" value={nextUnsaved?.id ?? ""} />
                    <button className="h-12 px-6 rounded-xl bg-ok text-white font-bold">{nextUnsaved ? `Onayla, kaydet → ${nextUnsaved.name.split(" ")[0]}` : "Onayla ve kaydet"}</button>
                  </form>
                )}
                {step === 6 && posted && <span className="text-sm text-muted">Bu bordronun kesintileri cariye yazıldı; değiştirmek için Bordro&apos;da kesintileri geri alın.</span>}
              </div>
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
