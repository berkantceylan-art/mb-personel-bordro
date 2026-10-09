import Link from "next/link";
import { redirect } from "next/navigation";
import { formatTL, nextPeriod, periodBounds, previousPeriod } from "@mb/core";
import { PendingSubmit } from "@/components/ConfirmSubmit";
import { Card, PageHeader } from "@/components/ui";
import { computePayroll } from "@/lib/payroll";
import { createClient } from "@/lib/supabase/server";
import { canManagePay, currentPeriod, formatDate, getSession, periodLabel, todayIso } from "@/lib/session";
import { fetchAll } from "@/lib/timekeeping";
import { saveSgkPayment } from "./actions";

type Sum = { employee_id: string; accrued: number | null; paid_bank: number | null; paid_cash: number | null; deductions: number | null; balance: number | null };

/** Patron ekranı: bu ayın maaş yükü, SGK, devamsızlık, giren-çıkan, bekleyen onaylar — mobil öncelikli */
export default async function BossPage({ searchParams }: { searchParams: Promise<{ donem?: string; ac?: string }> }) {
  const s = await getSession();
  if (!(s.boss || s.role === "owner")) redirect("/");
  const pay = canManagePay(s.role);
  const sp = await searchParams;
  const period = sp.donem && /^\d{4}-\d{2}$/.test(sp.donem) ? sp.donem : currentPeriod();
  const { start, end } = periodBounds(period);
  const today = todayIso();
  const open = sp.ac ?? "";
  const supabase = await createClient();

  const [sums, { data: emps }, { data: punches }, { data: leavesToday }, { data: adv }, { data: leavesPending }, { data: meals }, { data: profs }, { data: sgk }, payroll] = await Promise.all([
    fetchAll<Sum>((a, b) => supabase.from("ledger_period_summary").select("employee_id, accrued, paid_bank, paid_cash, deductions, balance").eq("period", period).order("employee_id").range(a, b)),
    supabase.from("employees").select("id, first_name, last_name, hire_date, termination_date, termination_reason, status, department_id, departments(name)"),
    supabase.from("attendance_punches").select("employee_id").gte("punched_at", `${today}T00:00:00`).not("employee_id", "is", null),
    supabase.from("leave_requests").select("employee_id, leave_types(name, code)").eq("status", "approved").lte("start_date", today).gte("end_date", today),
    supabase.from("advance_requests").select("id, amount").eq("status", "pending"),
    supabase.from("leave_requests").select("id").eq("status", "pending"),
    supabase.from("meal_requests").select("id, head_count").eq("status", "pending"),
    supabase.from("profile_change_requests").select("id").eq("status", "pending"),
    pay ? supabase.from("sgk_payments").select("*").eq("period", period).maybeSingle() : Promise.resolve({ data: null }),
    pay ? computePayroll(supabase, period) : Promise.resolve([]),
  ]);
  const n = (v: number | null | undefined) => Number(v ?? 0);
  const name = (e: { first_name: string; last_name: string }) => `${e.first_name} ${e.last_name === "-" ? "" : e.last_name}`.trim();
  const dept = (e: { departments: unknown }) => (e.departments as { name: string } | null)?.name ?? "Bölümsüz";
  const all = emps ?? [];
  const byId = new Map(all.map((e) => [e.id, e]));
  const active = all.filter((e) => e.status !== "terminated");

  // Maaş yükü
  const tot = sums.reduce((a, r) => ({ acc: a.acc + n(r.accrued), paid: a.paid + n(r.paid_bank) + n(r.paid_cash), ded: a.ded + n(r.deductions), bal: a.bal + n(r.balance), bank: a.bank + n(r.paid_bank), cash: a.cash + n(r.paid_cash) }), { acc: 0, paid: 0, ded: 0, bal: 0, bank: 0, cash: 0 });
  const owedList = sums.filter((r) => n(r.balance) > 0).sort((a, b) => n(b.balance) - n(a.balance));
  // SGK
  const sgkCalc = payroll.reduce((a, r) => { const b = r.result.breakdown; return { gross: a.gross + b.gross, premium: a.premium + (b.employerCost - b.gross) + b.sgkEmployee + b.unemploymentEmployee, cost: a.cost + b.employerCost, people: a.people + 1 }; }, { gross: 0, premium: 0, cost: 0, people: 0 });
  const sgkRow = (sgk as { accrued?: number; paid?: number; paid_on?: string | null; due_on?: string | null; note?: string | null } | null) ?? null;
  const sgkDebt = sgkRow ? n(sgkRow.accrued) - n(sgkRow.paid) : null;
  // Devamsızlık
  const punched = new Set((punches ?? []).map((p) => p.employee_id as string));
  const onLeave = new Map((leavesToday ?? []).map((l) => [l.employee_id, (l.leave_types as unknown as { name: string; code: string } | null)]));
  const isSunday = new Date(today + "T12:00:00").getDay() === 0;
  const absent = isSunday ? [] : active.filter((e) => !punched.has(e.id) && !onLeave.has(e.id) && (!e.hire_date || e.hire_date <= today));
  const leaveList = active.filter((e) => onLeave.has(e.id));
  // Giren / çıkan
  const hired = all.filter((e) => e.hire_date && e.hire_date >= start && e.hire_date <= end);
  const left = all.filter((e) => e.termination_date && e.termination_date >= start && e.termination_date <= end);
  // Bölüm
  const deptMap = new Map<string, { people: number; acc: number; bal: number }>();
  for (const r of sums) { const e = byId.get(r.employee_id); if (!e) continue; const d = dept(e); const g = deptMap.get(d) ?? { people: 0, acc: 0, bal: 0 }; g.people++; g.acc += n(r.accrued); g.bal += n(r.balance); deptMap.set(d, g); }
  const pendingTotal = (adv?.length ?? 0) + (leavesPending?.length ?? 0) + (meals?.length ?? 0) + (profs?.length ?? 0);
  const q = (ac: string) => `/patron?donem=${period}${ac ? `&ac=${ac}` : ""}`;
  const fmtQ = (k: number) => (k / 100).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const Tile = ({ id, label, value, sub, warn, href }: { id: string; label: string; value: string; sub?: string; warn?: boolean; href?: string }) => (
    <Link href={href ?? q(open === id ? "" : id)} className={`rounded-[14px] border p-4 flex flex-col gap-1 ${open === id ? "border-brand-700 bg-[#F2F6FB]" : warn ? "border-[#F2C94C] bg-[#FFF4E0]" : "border-line bg-white"}`}>
      <span className="text-xs text-muted">{label}</span>
      <span className={`num text-xl font-bold ${warn ? "text-[#8A5A00]" : "text-brand-800"}`}>{value}</span>
      {sub && <span className="text-xs text-muted">{sub}</span>}
    </Link>
  );
  const Row = ({ l, r, href }: { l: string; r: string; href?: string }) => (
    <li className="flex justify-between gap-3 py-1.5 border-b border-[#EEF2F6] last:border-0 text-sm">{href ? <Link href={href} className="font-semibold text-brand-700 truncate">{l}</Link> : <span className="truncate">{l}</span>}<span className="num whitespace-nowrap">{r}</span></li>
  );

  return (
    <>
      <PageHeader title="Patron ekranı" subtitle={`${periodLabel(period)} · ${active.length} aktif personel`} actions={
        <div className="flex gap-2">
          <Link href={`/patron?donem=${previousPeriod(period)}`} className="h-11 px-3 inline-flex items-center rounded-[10px] border border-[#D5DEE8] bg-white font-semibold text-brand-700">←</Link>
          <Link href={`/patron?donem=${nextPeriod(period)}`} className="h-11 px-3 inline-flex items-center rounded-[10px] border border-[#D5DEE8] bg-white font-semibold text-brand-700">→</Link>
        </div>
      } />
      <div className="p-4 md:p-6 flex flex-col gap-4 max-w-[1100px]">
        <div className="rounded-[14px] bg-brand-900 text-white p-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[["Maaş yükü (hakediş)", tot.acc], ["Ödenen", tot.paid], ["Personele kalan borç", tot.bal], ["Kesintiler (BES, icra…)", tot.ded]].map(([l, v]) => (
            <div key={String(l)}><div className="text-[11px] uppercase tracking-wide text-white/70">{l}</div><div className="num text-lg font-bold">{formatTL(Number(v))}</div></div>
          ))}
          <div className="col-span-2 sm:col-span-4 text-xs text-white/70">Banka {formatTL(tot.bank)} · Elden {formatTL(tot.cash)} · {owedList.length} kişiye ödeme kaldı</div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <Tile id="borc" label="Kime ne kadar kaldı" value={formatTL(tot.bal)} sub={`${owedList.length} kişi`} />
          {pay && <Tile id="sgk" label="SGK bu ay" value={sgkDebt !== null ? formatTL(sgkDebt) : formatTL(sgkCalc.premium)} sub={sgkDebt !== null ? (sgkDebt > 0 ? "ödenmemiş borç" : "ödendi") : `tahmini prim · ${sgkCalc.people} sigortalı`} warn={sgkDebt !== null && sgkDebt > 0} />}
          <Tile id="devamsiz" label="Bugün gelmeyen" value={String(absent.length)} sub={isSunday ? "pazar" : `${leaveList.length} izinli/raporlu`} warn={absent.length > 0} />
          <Tile id="giren" label="Bu ay işe giren" value={String(hired.length)} />
          <Tile id="cikan" label="Bu ay ayrılan" value={String(left.length)} warn={left.length > 0} />
          <Tile id="onay" label="Bekleyen onay" value={String(pendingTotal)} sub={`${adv?.length ?? 0} avans · ${leavesPending?.length ?? 0} izin · ${meals?.length ?? 0} yemek`} warn={pendingTotal > 0} href="/talepler" />
          <Tile id="bolum" label="Bölüm maliyeti" value={`${deptMap.size} bölüm`} />
        </div>

        {open === "borc" && (
          <Card title="Kime ne kadar kaldı" action={<Link href={`/kalan?donem=${period}`} className="text-sm font-semibold text-brand-700">Ayrıntı →</Link>}>
            <ul>{owedList.slice(0, 40).map((r) => { const e = byId.get(r.employee_id); return e ? <Row key={r.employee_id} l={`${name(e)} · ${dept(e)}`} r={formatTL(n(r.balance))} href={`/personel/${e.id}?donem=${period}`} /> : null; })}</ul>
            {owedList.length === 0 && <p className="text-sm text-muted">Bu ay ödemesi kalan yok.</p>}
          </Card>
        )}
        {open === "sgk" && pay && (
          <Card title={`SGK · ${periodLabel(period)}`}>
            <ul>
              <Row l="Resmi brüt toplam (bordro hesabı)" r={formatTL(sgkCalc.gross)} />
              <Row l="Tahmini SGK + işsizlik primi (işçi + işveren)" r={formatTL(sgkCalc.premium)} />
              <Row l="İşveren toplam resmi maliyeti" r={formatTL(sgkCalc.cost)} />
              {sgkRow && <Row l={`Tahakkuk (girilen)${sgkRow.due_on ? ` · son ödeme ${formatDate(sgkRow.due_on)}` : ""}`} r={formatTL(n(sgkRow.accrued))} />}
              {sgkRow && <Row l={`Ödenen${sgkRow.paid_on ? ` · ${formatDate(sgkRow.paid_on)}` : ""}`} r={formatTL(n(sgkRow.paid))} />}
              {sgkDebt !== null && <Row l="SGK borcu" r={formatTL(sgkDebt)} />}
            </ul>
            <form action={saveSgkPayment} className="grid gap-2 grid-cols-2 md:grid-cols-5 items-end text-sm">
              <input type="hidden" name="period" value={period} />
              <label className="flex flex-col gap-1 text-muted">Tahakkuk (TL)<input name="accrued" inputMode="decimal" defaultValue={sgkRow ? fmtQ(n(sgkRow.accrued)) : fmtQ(sgkCalc.premium)} className="h-10 rounded-lg border border-[#D5DEE8] px-2 num bg-white" /></label>
              <label className="flex flex-col gap-1 text-muted">Ödenen (TL)<input name="paid" inputMode="decimal" defaultValue={sgkRow ? fmtQ(n(sgkRow.paid)) : ""} className="h-10 rounded-lg border border-[#D5DEE8] px-2 num bg-white" /></label>
              <label className="flex flex-col gap-1 text-muted">Ödeme tarihi<input type="date" name="paid_on" defaultValue={sgkRow?.paid_on ?? ""} className="h-10 rounded-lg border border-[#D5DEE8] px-2 bg-white" /></label>
              <label className="flex flex-col gap-1 text-muted">Son ödeme günü<input type="date" name="due_on" defaultValue={sgkRow?.due_on ?? `${nextPeriod(period)}-26`} className="h-10 rounded-lg border border-[#D5DEE8] px-2 bg-white" /></label>
              <PendingSubmit className="h-10 px-4 rounded-lg bg-brand-700 text-white font-semibold">Kaydet</PendingSubmit>
              <p className="col-span-2 md:col-span-5 text-xs text-muted">Tahakkuk tutarını e-Bildirge&apos;deki aylık prim ve hizmet belgesinden alıp girin; tahmin bordro hesabıdır (teşvik ve asgari ücret desteği dâhil değildir).</p>
            </form>
          </Card>
        )}
        {open === "devamsiz" && (
          <Card title={`Bugün gelmeyenler · ${formatDate(today)}`} action={<Link href="/puantaj" className="text-sm font-semibold text-brand-700">Puantaj →</Link>}>
            <ul>{absent.map((e) => <Row key={e.id} l={`${name(e)} · ${dept(e)}`} r="habersiz / okutma yok" href={`/personel/${e.id}`} />)}</ul>
            {absent.length === 0 && <p className="text-sm text-muted">{isSunday ? "Pazar." : "Herkes okutma yaptı."}</p>}
            {leaveList.length > 0 && <><div className="text-xs uppercase tracking-wide text-muted mt-2">İzinli / raporlu</div><ul>{leaveList.map((e) => <Row key={e.id} l={`${name(e)} · ${dept(e)}`} r={onLeave.get(e.id)?.name ?? "izinli"} href={`/personel/${e.id}`} />)}</ul></>}
            <p className="text-xs text-muted">Okutma listesi anlıktır; vardiyası sonradan başlayanlar da burada görünür.</p>
          </Card>
        )}
        {open === "giren" && (
          <Card title={`${periodLabel(period)} işe girenler`}>
            <ul>{hired.map((e) => <Row key={e.id} l={`${name(e)} · ${dept(e)}`} r={formatDate(e.hire_date!)} href={`/personel/${e.id}`} />)}</ul>
            {hired.length === 0 && <p className="text-sm text-muted">Bu ay işe giren yok.</p>}
          </Card>
        )}
        {open === "cikan" && (
          <Card title={`${periodLabel(period)} ayrılanlar`}>
            <ul>{left.map((e) => <Row key={e.id} l={`${name(e)} · ${dept(e)}${e.termination_reason ? ` · ${e.termination_reason}` : ""}`} r={formatDate(e.termination_date!)} href={`/personel/${e.id}`} />)}</ul>
            {left.length === 0 && <p className="text-sm text-muted">Bu ay ayrılan yok.</p>}
          </Card>
        )}
        {open === "bolum" && (
          <Card title={`Bölüm başına · ${periodLabel(period)}`}>
            <ul>{[...deptMap.entries()].sort((a, b) => b[1].acc - a[1].acc).map(([d, g]) => <Row key={d} l={`${d} · ${g.people} kişi`} r={`${formatTL(g.acc)} · kalan ${formatTL(g.bal)}`} />)}</ul>
          </Card>
        )}
      </div>
    </>
  );
}
