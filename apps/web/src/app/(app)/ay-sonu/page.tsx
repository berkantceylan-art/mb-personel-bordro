import Link from "next/link";
import { redirect } from "next/navigation";
import { formatTL, nextPeriod, periodBounds, previousPeriod } from "@mb/core";
import { PageHeader } from "@/components/ui";
import { ConfirmSubmit } from "@/components/ConfirmSubmit";
import { CreatePeriodButton } from "../donemler/CreatePeriodButton";
import { setPeriodStatus } from "../donemler/actions";
import { MissingDaysButton } from "../puantaj/PunchForms";
import { PayrollButtons } from "../bordro/PayrollButtons";
import { SalaryButton } from "./SalaryButton";
import { computePayroll } from "@/lib/payroll";
import { overtimeSuggestions } from "@/lib/overtime";
import { createClient } from "@/lib/supabase/server";
import { canManagePay, currentPeriod, getSession, periodLabel } from "@/lib/session";
import { loadMonth } from "@/lib/timekeeping";

type State = "done" | "todo" | "warn" | "wait";

function Step({ n, title, state, status, children }: { n: number; title: string; state: State; status: React.ReactNode; children?: React.ReactNode }) {
  const badge = {
    done: "bg-ok text-white",
    todo: "bg-brand-700 text-white",
    warn: "bg-warn text-white",
    wait: "bg-[#D5DEE8] text-muted",
  }[state];
  return (
    <li className="relative flex gap-3 md:gap-4">
      <div className="flex flex-col items-center">
        <span className={`w-9 h-9 rounded-full grid place-items-center font-bold text-sm shrink-0 ${badge}`} aria-hidden>{state === "done" ? "✓" : n}</span>
        <span className="flex-1 w-px bg-line mt-1" />
      </div>
      <section className={`flex-1 min-w-0 mb-4 bg-white border rounded-[14px] p-4 md:p-5 flex flex-col gap-3 ${state === "todo" ? "border-brand-700 shadow-sm" : "border-line"}`}>
        <div className="flex flex-col gap-0.5">
          <h2 className="font-display font-bold text-brand-800">{title}</h2>
          <p className={`text-sm ${state === "warn" ? "text-warn" : state === "done" ? "text-ok" : "text-muted"}`}>{status}</p>
        </div>
        {children}
      </section>
    </li>
  );
}

const btn = "h-11 px-4 inline-flex items-center rounded-[10px] border border-[#D5DEE8] bg-white text-brand-700 font-semibold";

export default async function MonthEndPage({ searchParams }: { searchParams: Promise<{ donem?: string }> }) {
  const s = await getSession();
  if (!canManagePay(s.role)) redirect("/");
  const sp = await searchParams;
  // Varsayılan: içinde bulunulan ayın ilk 10 gününde önceki ay kapanır
  const today = new Date().toISOString().slice(0, 10);
  const def = Number(today.slice(8, 10)) <= 10 ? previousPeriod(currentPeriod()) : currentPeriod();
  const period = sp.donem && /^\d{4}-\d{2}$/.test(sp.donem) ? sp.donem : def;
  const { start, end } = periodBounds(period);
  const supabase = await createClient();

  const [{ data: per }, { count: accruals }, { count: employed }, { count: pendingLeave }, { count: pendingAdv }, { data: otRecs }, { count: missingWritten }] = await Promise.all([
    supabase.from("payroll_periods").select("status").eq("period", period).maybeSingle(),
    supabase.from("ledger_entries").select("id", { count: "exact", head: true }).eq("period", period).eq("type", "ACCRUAL").is("voided_at", null),
    supabase.from("employees").select("id", { count: "exact", head: true }).lte("hire_date", end).or(`termination_date.is.null,termination_date.gte.${start}`),
    supabase.from("leave_requests").select("id", { count: "exact", head: true }).eq("status", "pending").lte("start_date", end),
    supabase.from("advance_requests").select("id", { count: "exact", head: true }).eq("status", "pending"),
    supabase.from("overtime_records").select("employee_id, work_date, status").eq("period", period),
    supabase.from("ledger_entries").select("id", { count: "exact", head: true }).eq("period", period).eq("type", "DEDUCTION").like("note", "Eksik gün%").is("voided_at", null),
  ]);
  const closed = per?.status === "closed";
  const opened = !!per;

  const [m, prev, rows] = await Promise.all([
    loadMonth(supabase, period),
    loadMonth(supabase, previousPeriod(period)),
    opened ? computePayroll(supabase, period) : Promise.resolve([]),
  ]);

  // Puantaj
  const anomalies = m.anomalies.filter((a) => a.kind === "MISSING_IN" || a.kind === "MISSING_OUT").length;
  let missingPeople = 0, missingDays = 0;
  for (const e of m.employees) {
    let d = 0;
    for (const c of m.cells.get(e.id)!.values()) if (c.employed && (c.status === "ABSENT" || c.leaveCode === "UCRETSIZ" || c.leaveCode === "RAPOR")) d++;
    if (d) { missingPeople++; missingDays += d; }
  }
  // Fazla mesai
  const decided = new Set((otRecs ?? []).map((r) => `${r.employee_id}|${r.work_date}`));
  const otOpen = overtimeSuggestions(m, prev).suggestions.filter((x) => !decided.has(`${x.employeeId}|${x.date}`)).length;
  const otPending = (otRecs ?? []).filter((r) => r.status === "pending").length;
  // Bordro
  const saved = rows.filter((r) => r.saved).length;
  const posted = rows.filter((r) => r.saved?.posted).length;
  const deductionsDue = rows.some((r) => r.result.breakdown.bes + r.result.garnishmentTotal > 0);
  const bankLeft = rows.reduce((a, r) => a + r.pay.bank, 0);
  const cashLeft = rows.reduce((a, r) => a + r.pay.cash, 0);
  const negative = rows.filter((r) => r.ledger.balance < 0).length;
  const payDate = today > end ? today : end;

  const st = {
    open: opened && (accruals ?? 0) > 0 ? "done" : "todo",
    punch: anomalies ? "warn" : "done",
    requests: (pendingLeave ?? 0) + (pendingAdv ?? 0) ? "warn" : "done",
    ot: otOpen + otPending ? "warn" : "done",
    missing: missingDays === 0 || (missingWritten ?? 0) > 0 ? "done" : "todo",
    payroll: !opened ? "wait" : saved >= rows.length && rows.length > 0 && (!deductionsDue || posted >= rows.length) ? "done" : "todo",
    files: !opened || saved < rows.length ? "wait" : "todo",
    pay: !opened ? "wait" : bankLeft + cashLeft === 0 ? "done" : "todo",
    close: closed ? "done" : !opened ? "wait" : "todo",
  } satisfies Record<string, State>;
  const doneCount = Object.values(st).filter((x) => x === "done").length;

  return (
    <>
      <PageHeader
        title="Ay sonu"
        subtitle={`${periodLabel(period)} · ${doneCount}/9 adım tamam${closed ? " · dönem kapalı" : ""}`}
        actions={
          <div className="flex gap-2">
            <Link href={`/ay-sonu?donem=${previousPeriod(period)}`} className="h-11 px-3 inline-flex items-center rounded-[10px] border border-[#D5DEE8] bg-white font-semibold text-brand-700" aria-label="Önceki ay">←</Link>
            <Link href={`/ay-sonu?donem=${nextPeriod(period)}`} className="h-11 px-3 inline-flex items-center rounded-[10px] border border-[#D5DEE8] bg-white font-semibold text-brand-700" aria-label="Sonraki ay">→</Link>
          </div>
        }
      />
      <div className="p-4 md:p-8 max-w-[860px]">
        <p className="text-sm text-muted mb-4">Adımları yukarıdan aşağı izleyin. Uyarılı adımlar engel değildir ama bordrodan önce bakmanız önerilir. Her buton tekrar çalıştırılabilir; daha önce yazılanlar atlanır.</p>
        <ol>
          <Step n={1} title="Dönemi aç, hakedişleri yaz" state={st.open} status={opened ? `${accruals ?? 0}/${employed ?? 0} personele hakediş yazılı.` : "Dönem henüz açılmamış."}>
            {!closed && (accruals ?? 0) < (employed ?? 0) && <CreatePeriodButton period={period} label={opened ? "Eksik hakedişleri yaz" : `${periodLabel(period)} dönemini aç`} variant={opened ? "secondary" : "primary"} />}
          </Step>

          <Step n={2} title="Okutmaları kontrol et" state={st.punch} status={anomalies ? `${anomalies} eksik giriş/çıkış var; düzeltilmezse o günler devamsız sayılabilir.` : "Eksik giriş/çıkış yok."}>
            <div className="flex flex-wrap gap-2"><Link href={`/puantaj?donem=${period}`} className={btn}>Puantajı aç</Link><Link href="/puantaj/yukle" className={btn}>Cihaz dosyası yükle</Link></div>
          </Step>

          <Step n={3} title="Bekleyen talepler" state={st.requests} status={(pendingLeave ?? 0) + (pendingAdv ?? 0) ? `${pendingLeave ?? 0} izin, ${pendingAdv ?? 0} avans talebi bekliyor.` : "Bekleyen talep yok."}>
            {(pendingLeave ?? 0) + (pendingAdv ?? 0) > 0 && <Link href="/talepler" className={`${btn} self-start`}>Talepleri aç</Link>}
          </Step>

          <Step n={4} title="Fazla mesaileri onayla" state={st.ot} status={otOpen + otPending ? `${otOpen} öneri onay bekliyor${otPending ? `, ${otPending} kayıt beklemede` : ""}.` : "Onay bekleyen fazla mesai yok."}>
            {otOpen + otPending > 0 && <Link href={`/fazla-mesai?donem=${period}`} className={`${btn} self-start`}>Fazla mesaiye git</Link>}
          </Step>

          <Step n={5} title="Eksik günleri hakedişe yansıt" state={st.missing} status={missingDays === 0 ? "Devamsızlık, ücretsiz izin veya rapor günü yok." : (missingWritten ?? 0) > 0 ? `Yazıldı. Sonradan eklenen günler için tekrar çalıştırabilirsiniz.` : `${missingPeople} personelde toplam ${missingDays} eksik gün var.`}>
            {missingDays > 0 && !closed && opened && <MissingDaysButton period={period} />}
          </Step>

          <Step n={6} title="Bordroyu hesapla, kesintileri yaz" state={st.payroll} status={!opened ? "Önce dönemi açın." : `${saved}/${rows.length} bordro kayıtlı${deductionsDue ? ` · ${posted}/${rows.length} kesinti cariye yazılı` : " · BES/icra kesintisi yok"}.`}>
            {opened && !closed && <PayrollButtons period={period} canPost={saved > 0 && posted < rows.length} canUnpost={false} />}
            {opened && <Link href={`/bordro?donem=${period}`} className="text-sm font-semibold text-brand-700">Bordroyu ayrıntılı gör →</Link>}
          </Step>

          <Step n={7} title="Banka dosyalarını indir" state={st.files} status={saved < rows.length || !opened ? "Bordro kaydedildikten sonra indirin." : `Bankaya kalan: ${formatTL(bankLeft)}. Dosyaları Garanti BBVA internet şubesine yükleyin.`}>
            {opened && (
              <div className="flex flex-wrap gap-2">
                <a href={`/raporlar/banka-maas/excel?donem=${period}&kaynak=kalan&odeme=${payDate}`} className={btn}>Garanti maaş dosyası</a>
                <a href={`/raporlar/bes-liste/excel?donem=${period}&odeme=${payDate}`} className={btn}>BES ödeme dosyası</a>
                <Link href={`/raporlar/banka-maas?donem=${period}`} className="h-11 inline-flex items-center text-sm font-semibold text-brand-700">Seçenekler →</Link>
              </div>
            )}
          </Step>

          <Step n={8} title="Ödemeleri cariye işle" state={st.pay} status={!opened ? "Önce dönemi açın." : bankLeft + cashLeft === 0 ? "Kalan ödeme yok." : `Banka ${formatTL(bankLeft)} · elden ${formatTL(cashLeft)} ödenecek.`}>
            {opened && !closed && (
              <div className="grid gap-4 md:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <p className="text-xs text-muted">Banka transferi yapıldıktan sonra:</p>
                  <SalaryButton period={period} channel="BANK" label="Banka ödemelerini işle" defaultDate={payDate} disabled={bankLeft === 0} />
                </div>
                <div className="flex flex-col gap-1.5">
                  <p className="text-xs text-muted">Elden ödemeler dağıtılırken:</p>
                  <SalaryButton period={period} channel="CASH" label="Elden ödemeleri işle" defaultDate={payDate} disabled={cashLeft === 0} />
                  <a href={`/yazdir/avans?bas=${start}&bit=${nextPeriod(period)}-15&tur=SALARY&kanal=CASH`} target="_blank" className="text-sm font-semibold text-brand-700">Elden ödeme makbuzlarını yazdır →</a>
                </div>
              </div>
            )}
          </Step>

          <Step n={9} title="Dönemi kapat" state={st.close} status={closed ? "Dönem kapalı; kalan bakiyeler sonraki aya devredildi." : negative ? `${negative} personelin bakiyesi eksi (fazla ödeme); kapatınca sonraki aydan düşülür.` : "Kapatınca kalan bakiyeler sonraki aya devreder ve dönem kilitlenir."}>
            {opened && (
              <form action={setPeriodStatus}>
                <input type="hidden" name="period" value={period} />
                <input type="hidden" name="status" value={closed ? "open" : "closed"} />
                <ConfirmSubmit
                  label={closed ? "Dönemi yeniden aç" : `${periodLabel(period)} dönemini kapat`}
                  question={closed ? "Dönem açılsın ve devir hareketleri geri alınsın mı?" : "Dönem kapatılsın mı? Kalan bakiyeler sonraki aya devredilir ve bu dönemde değişiklik yapılamaz."}
                  className={closed ? btn : "h-11 px-5 rounded-[10px] bg-brand-700 text-white font-semibold"}
                />
              </form>
            )}
          </Step>
        </ol>
      </div>
    </>
  );
}
