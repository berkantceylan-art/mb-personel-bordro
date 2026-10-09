import Link from "next/link";
import { redirect } from "next/navigation";
import { formatTL, nextPeriod, periodBounds, previousPeriod } from "@mb/core";
import { PendingSubmit } from "@/components/ConfirmSubmit";
import { Card, PageHeader } from "@/components/ui";
import {
  addDays, approvalCount, deptOf, headcountAt, loadApprovals, loadAttendanceStats, loadCalendar, loadCelebrations, loadEmployees, loadMoney, loadRisks, loadTrend,
  nameOf, periodName, todayFrom, type Approvals, type CalItem, type EmpLite, type MoneyData, type TodayData,
} from "@/lib/boss";
import { decideAdvance, decideProfileChange, decidePunchRequest } from "@/lib/comms-actions";
import { approveOvertime, decideLeave } from "@/lib/leave-ot-actions";
import { createClient } from "@/lib/supabase/server";
import { canManagePay, currentPeriod, formatDate, getSession, periodLabel, todayIso } from "@/lib/session";
import { fetchAll, loadMonth } from "@/lib/timekeeping";
import { decideMeal } from "../yemek/actions";
import { savePayDay, saveSgkPayment } from "./actions";

type Tab = "ozet" | "para" | "insan" | "risk";
const TABS: Array<[Tab, string]> = [["ozet", "Özet"], ["para", "Para"], ["insan", "İnsan"], ["risk", "Risk"]];
type SB = Awaited<ReturnType<typeof createClient>>;

/** Patron ekranı: Özet · Para · İnsan · Risk — mobil öncelikli */
export default async function BossPage({ searchParams }: { searchParams: Promise<{ donem?: string; sekme?: string }> }) {
  const s = await getSession();
  if (!(s.boss || s.role === "owner") || !canManagePay(s.role)) redirect("/");
  const sp = await searchParams;
  const tab: Tab = (["ozet", "para", "insan", "risk"] as const).find((t) => t === sp.sekme) ?? "ozet";
  const today = todayIso();
  const cur = currentPeriod();
  const period = sp.donem && /^\d{4}-\d{2}$/.test(sp.donem) ? sp.donem : cur;
  const supabase = await createClient();
  const [emps, approvals, { data: company }] = await Promise.all([loadEmployees(supabase), loadApprovals(supabase), supabase.from("companies").select("*").eq("id", s.companyId).maybeSingle()]);
  const payDay = Number((company as { salary_pay_day?: number } | null)?.salary_pay_day ?? 5);
  const active = emps.filter((e) => e.status !== "terminated");
  const pending = approvalCount(approvals);
  const href = (t: Tab, p = period) => `/patron?sekme=${t}${p !== cur ? `&donem=${p}` : ""}`;

  return (
    <>
      <PageHeader title="Patron ekranı" subtitle={`${formatDate(today)} · ${active.length} aktif personel`} actions={
        tab === "para" || tab === "insan" ? (
          <div className="flex gap-2 items-center">
            <Link href={href(tab, previousPeriod(period))} aria-label="Önceki ay" className="h-11 w-11 grid place-items-center rounded-[10px] border border-[#D5DEE8] bg-white font-semibold text-brand-700">←</Link>
            <span className="text-sm font-semibold text-brand-800 min-w-[92px] text-center">{periodLabel(period)}</span>
            <Link href={href(tab, nextPeriod(period))} aria-label="Sonraki ay" className="h-11 w-11 grid place-items-center rounded-[10px] border border-[#D5DEE8] bg-white font-semibold text-brand-700">→</Link>
          </div>
        ) : undefined
      } />
      <nav className="sticky top-0 z-10 bg-[#F5F7FA]/95 backdrop-blur px-4 md:px-6 pt-3 pb-2" aria-label="Patron sekmeleri">
        <div className="grid grid-cols-4 gap-1 p-1 rounded-xl bg-white border border-line max-w-[560px]">
          {TABS.map(([t, l]) => (
            <Link key={t} href={href(t)} aria-current={tab === t ? "page" : undefined} className={`h-10 rounded-lg grid place-items-center text-sm font-semibold relative ${tab === t ? "bg-brand-800 text-white" : "text-brand-700"}`}>
              {l}{t === "ozet" && pending > 0 && <span className="absolute top-1 right-2 min-w-[18px] h-[18px] px-1 rounded-full bg-[#D64545] text-white text-[10px] grid place-items-center">{pending}</span>}
            </Link>
          ))}
        </div>
      </nav>
      <div className="p-4 md:p-6 pt-2 flex flex-col gap-4 max-w-[1100px]">
        {tab === "ozet" && <Overview sb={supabase} today={today} cur={cur} payDay={payDay} emps={emps} approvals={approvals} />}
        {tab === "para" && <Money sb={supabase} today={today} cur={cur} period={period} payDay={payDay} emps={emps} />}
        {tab === "insan" && <People sb={supabase} today={today} cur={cur} period={period} emps={emps} />}
        {tab === "risk" && <Risks sb={supabase} today={today} cur={cur} emps={emps} />}
      </div>
    </>
  );
}

/* ================================================================ Özet */
async function Overview({ sb, today, cur, payDay, emps, approvals }: { sb: SB; today: string; cur: string; payDay: number; emps: EmpLite[]; approvals: Approvals }) {
  const [month, mCur, mPrev] = await Promise.all([loadMonth(sb, cur), loadMoney(sb, cur), loadMoney(sb, previousPeriod(cur))]);
  const t = todayFrom(month, today);
  const cal = await loadCalendar(sb, today, new Map([[cur, mCur], [mPrev.period, mPrev]]), payDay, emps);
  const week = cal.filter((c) => c.status !== "paid" && c.status !== "info" && c.date <= addDays(today, 7));
  return (
    <>
      <TodayStrip t={t} />
      <CostHero m={mCur} prev={mPrev} />
      <Card title="Önümüzdeki 7 gün ödemeler" action={<Link href="/patron?sekme=para#takvim" className="text-sm font-semibold text-brand-700">30 gün →</Link>}>
        <WeekTotal items={week} />
        <CalendarList items={cal.filter((c) => c.status === "late" || (c.date >= today && c.date <= addDays(today, 7)))} today={today} empty="Bu hafta ödeme görünmüyor." />
      </Card>
      <ApprovalsCard a={approvals} today={today} />
    </>
  );
}

/* ================================================================ Para */
async function Money({ sb, today, cur, period, payDay, emps }: { sb: SB; today: string; cur: string; period: string; payDay: number; emps: EmpLite[] }) {
  const prevP = previousPeriod(period);
  const lastYear = `${Number(period.slice(0, 4)) - 1}${period.slice(4)}`;
  const [m, prev, ly, trend, { data: sgkRow }] = await Promise.all([
    loadMoney(sb, period), loadMoney(sb, prevP), loadMoney(sb, lastYear), loadTrend(sb, period, emps),
    sb.from("sgk_payments").select("*").eq("period", period).maybeSingle(),
  ]);
  const calMoney = new Map<string, MoneyData>([[period, m], [prevP, prev]]);
  if (!calMoney.has(cur)) calMoney.set(cur, await loadMoney(sb, cur));
  if (!calMoney.has(previousPeriod(cur))) calMoney.set(previousPeriod(cur), await loadMoney(sb, previousPeriod(cur)));
  const cal = await loadCalendar(sb, today, calMoney, payDay, emps);
  const row = sgkRow as { accrued?: number; paid?: number; paid_on?: string | null; due_on?: string | null; tax_accrued?: number; tax_paid?: number; tax_paid_on?: string | null } | null;
  const owed = m.rows.filter((r) => r.pay.bank + r.pay.cash > 0).sort((a, b) => b.pay.bank + b.pay.cash - (a.pay.bank + a.pay.cash));
  const fmtQ = (k: number) => (k / 100).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const input = "h-11 rounded-lg border border-[#D5DEE8] px-2 num bg-white text-ink";
  return (
    <>
      <CostHero m={m} prev={prev} lastYear={ly} />
      <Card title={`Maliyet kırılımı · ${periodLabel(period)}`}>
        <Bars parts={[["Net maaş", m.salary, "#0A3D73"], ["Fazla mesai", m.overtime, "#2F6FB3"], ["SGK primleri", m.sgk, "#7FA7D4"], ["Gelir + damga vergisi", m.tax, "#B9CFE8"]]} total={m.totalCost} />
        <div className="grid grid-cols-2 gap-3">
          <Mini label="Bankadan (resmi net)" value={formatTL(m.officialNet)} sub={`ödenen ${formatTL(m.paidBank)} · kalan ${formatTL(m.remainBank)}`} />
          <Mini label="Elden" value={formatTL(m.cashNet)} sub={`ödenen ${formatTL(m.paidCash)} · kalan ${formatTL(m.remainCash)}`} />
          <Mini label="Ay içi avans" value={formatTL(m.advances)} />
          <Mini label="BES + icra kesintisi" value={formatTL(m.bes + m.garnishment)} sub={`BES ${formatTL(m.bes)} · icra ${formatTL(m.garnishment)}`} />
        </div>
        <p className="text-xs text-muted">Toplam maliyet = personele giden net hakediş (banka + elden, mesai dâhil) + SGK primleri (işçi + işveren) + gelir ve damga vergisi. SGK teşvikleri bordro ayarındaki puanla hesaplanır.</p>
      </Card>

      <Card title="Son 12 ay · personele net hakediş">
        <TrendChart data={trend.map((x) => ({ label: periodName(x.period).slice(0, 3), title: `${periodLabel(x.period)}: ${formatTL(x.accrued)} · ${x.headcount} kişi`, value: x.accrued, active: x.period === period }))} fmt={(v) => `${Math.round(v / 100_000_00) / 10} mn`} />
        <p className="text-xs text-muted">Sisteme işlenmiş ayların cari hesap hakedişi (banka + elden). Eski aylar işlendikçe dolar. Çubuğun üstüne gelince tutar görünür.</p>
      </Card>

      <section id="takvim" className="scroll-mt-20">
        <Card title="Ödeme takvimi · 30 gün" action={
          <form action={savePayDay} className="flex items-center gap-2 text-xs text-muted">
            <label htmlFor="payday">Maaş günü: sonraki ayın</label>
            <input id="payday" name="day" type="number" min={1} max={28} defaultValue={payDay} className="h-9 w-14 rounded-lg border border-[#D5DEE8] px-2 num bg-white text-ink" />
            <PendingSubmit className="h-9 px-3 rounded-lg border border-[#D5DEE8] bg-white font-semibold text-brand-700">Kaydet</PendingSubmit>
          </form>
        }>
          <WeekTotal items={cal.filter((c) => c.status !== "paid" && c.status !== "info" && c.date <= addDays(today, 7))} />
          <CalendarList items={cal} today={today} empty="Önümüzdeki 30 günde ödeme görünmüyor." />
        </Card>
      </section>

      <section id="sgk" className="scroll-mt-20">
        <Card title={`SGK ve muhtasar · ${periodLabel(period)}`}>
          <ul>
            <Row l="Tahmini SGK primi (işçi + işveren + işsizlik)" r={formatTL(m.sgk)} />
            <Row l="Tahmini muhtasar (gelir + damga vergisi)" r={formatTL(m.tax)} />
            {row && <Row l={`SGK borcu (tahakkuk − ödenen)`} r={formatTL(Number(row.accrued ?? 0) - Number(row.paid ?? 0))} />}
            {row?.tax_accrued ? <Row l="Muhtasar borcu" r={formatTL(Number(row.tax_accrued) - Number(row.tax_paid ?? 0))} /> : null}
          </ul>
          <form action={saveSgkPayment} className="grid gap-2 grid-cols-2 md:grid-cols-4 items-end text-sm">
            <input type="hidden" name="period" value={period} />
            <label className="flex flex-col gap-1 text-muted">SGK tahakkuk (TL)<input name="accrued" inputMode="decimal" defaultValue={row ? fmtQ(Number(row.accrued ?? 0)) : fmtQ(m.sgk)} className={input} /></label>
            <label className="flex flex-col gap-1 text-muted">SGK ödenen (TL)<input name="paid" inputMode="decimal" defaultValue={row ? fmtQ(Number(row.paid ?? 0)) : ""} className={input} /></label>
            <label className="flex flex-col gap-1 text-muted">SGK ödeme tarihi<input type="date" name="paid_on" defaultValue={row?.paid_on ?? ""} className={input} /></label>
            <label className="flex flex-col gap-1 text-muted">Son ödeme günü<input type="date" name="due_on" defaultValue={row?.due_on ?? `${nextPeriod(period)}-26`} className={input} /></label>
            <label className="flex flex-col gap-1 text-muted">Muhtasar tahakkuk (TL)<input name="tax_accrued" inputMode="decimal" defaultValue={row?.tax_accrued ? fmtQ(Number(row.tax_accrued)) : fmtQ(m.tax)} className={input} /></label>
            <label className="flex flex-col gap-1 text-muted">Muhtasar ödenen (TL)<input name="tax_paid" inputMode="decimal" defaultValue={row?.tax_paid ? fmtQ(Number(row.tax_paid)) : ""} className={input} /></label>
            <label className="flex flex-col gap-1 text-muted">Muhtasar ödeme tarihi<input type="date" name="tax_paid_on" defaultValue={row?.tax_paid_on ?? ""} className={input} /></label>
            <PendingSubmit className="h-11 px-4 rounded-lg bg-brand-700 text-white font-semibold">Kaydet</PendingSubmit>
            <p className="col-span-2 md:col-span-4 text-xs text-muted">Tahakkukları e-Bildirge ve muhtasar beyannamesinden girin; girilene kadar takvimde bordro tahmini görünür. Ödenen tutar tahakkuka ulaşınca takvimde ✓ olur.</p>
          </form>
        </Card>
      </section>

      <Card title={`Kime ne kadar kaldı · ${periodLabel(period)}`} action={<Link href={`/kalan?donem=${period}`} className="text-sm font-semibold text-brand-700">Ödeme ekranı →</Link>}>
        <ul className="divide-y divide-[#EEF2F6]">{owed.slice(0, 40).map((r) => (
          <li key={r.employeeId}><Link href={`/personel/${r.employeeId}?donem=${period}`} className="flex flex-wrap justify-between gap-x-3 py-2 text-sm">
            <span className="font-semibold text-brand-700">{r.name} <span className="font-normal text-muted text-xs">· {r.dept}</span></span>
            <span className="num whitespace-nowrap"><b>{formatTL(r.pay.bank + r.pay.cash)}</b> <span className="text-xs text-muted">banka {formatTL(r.pay.bank)} · elden {formatTL(r.pay.cash)}</span></span>
          </Link></li>
        ))}</ul>
        {owed.length === 0 ? <p className="text-sm text-muted">Bu ay ödemesi kalan yok.</p> : owed.length > 40 && <p className="text-xs text-muted">İlk 40 kişi; tamamı ödeme ekranında.</p>}
      </Card>
    </>
  );
}

/* ================================================================ İnsan */
async function People({ sb, today, cur, period, emps }: { sb: SB; today: string; cur: string; period: string; emps: EmpLite[] }) {
  const { start, end } = periodBounds(period);
  const month = await loadMonth(sb, cur);
  const [stats, cele, money, ot] = await Promise.all([
    loadAttendanceStats(sb, today, month),
    loadCelebrations(sb, today, emps),
    loadMoney(sb, period),
    fetchAll<{ employee_id: string; minutes: number }>((a, b) => sb.from("overtime_records").select("employee_id, minutes").eq("period", period).eq("status", "approved").order("id").range(a, b)),
  ]);
  const t = todayFrom(month, today);
  const hired = emps.filter((e) => e.hire_date && e.hire_date >= start && e.hire_date <= end);
  const left = emps.filter((e) => e.termination_date && e.termination_date >= start && e.termination_date <= end);
  const trend: Array<{ p: string; n: number }> = [];
  for (let p = period, i = 0; i < 12; i++, p = previousPeriod(p)) trend.unshift({ p, n: headcountAt(emps, periodBounds(p).end) });
  const yearAgo = addDays(today, -365);
  const left12 = emps.filter((e) => e.termination_date && e.termination_date > yearAgo && e.termination_date <= today).length;
  const avgHead = trend.reduce((a, x) => a + x.n, 0) / Math.max(1, trend.length);
  const turnover = avgHead ? Math.round((left12 / avgHead) * 1000) / 10 : 0;
  // Bölümler
  const byId = new Map(emps.map((e) => [e.id, e]));
  const dm = new Map<string, { people: number; cost: number; otMin: number }>();
  for (const e of emps) if (e.hire_date && e.hire_date <= end && (!e.termination_date || e.termination_date >= start)) { const d = deptOf(e); const g = dm.get(d) ?? { people: 0, cost: 0, otMin: 0 }; g.people++; g.cost += money.byEmployee.get(e.id)?.cost ?? 0; dm.set(d, g); }
  for (const o of ot) { const e = byId.get(o.employee_id); if (!e) continue; const g = dm.get(deptOf(e)); if (g) g.otMin += Number(o.minutes); }
  const depts = [...dm.entries()].sort((a, b) => b[1].cost - a[1].cost);
  const reasonOf = (e: EmpLite) => e.termination_reason || (e.termination_code ? `Kod ${e.termination_code}` : "—");

  return (
    <>
      <TodayStrip t={t} open />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Mini label="Aktif personel" value={String(emps.filter((e) => e.status !== "terminated").length)} />
        <Mini label={`${periodName(period)} işe giren`} value={String(hired.length)} />
        <Mini label={`${periodName(period)} ayrılan`} value={String(left.length)} warn={left.length > 0} />
        <Mini label="Yıllık devir oranı" value={`%${turnover.toLocaleString("tr-TR")}`} sub={`son 12 ayda ${left12} ayrılış`} />
      </div>
      <Card title="Personel sayısı · son 12 ay">
        <TrendChart data={trend.map((x) => ({ label: periodName(x.p).slice(0, 3), title: `${periodLabel(x.p)} sonu: ${x.n} kişi`, value: x.n, active: x.p === period }))} fmt={(v) => String(v)} />
      </Card>
      <div className="grid gap-4 md:grid-cols-2">
        <Card title={`${periodLabel(period)} işe girenler`}>
          <ul>{hired.map((e) => <Row key={e.id} l={`${nameOf(e)} · ${deptOf(e)}`} r={formatDate(e.hire_date!)} href={`/personel/${e.id}`} />)}</ul>
          {hired.length === 0 && <p className="text-sm text-muted">Bu ay işe giren yok.</p>}
        </Card>
        <Card title={`${periodLabel(period)} ayrılanlar`}>
          <ul>{left.map((e) => <Row key={e.id} l={`${nameOf(e)} · ${deptOf(e)} · ${reasonOf(e)}`} r={formatDate(e.termination_date!)} href={`/personel/${e.id}`} />)}</ul>
          {left.length === 0 && <p className="text-sm text-muted">Bu ay ayrılan yok.</p>}
        </Card>
        <Card title="En çok devamsızlık · son 3 ay">
          <ul>{stats.topAbsent.map((x) => <Row key={x.id} l={`${x.name} · ${x.dept}`} r={`${x.absent} gün`} href={`/personel/${x.id}`} />)}</ul>
          {stats.topAbsent.length === 0 && <p className="text-sm text-muted">Devamsızlık yok.</p>}
        </Card>
        <Card title="En çok geç kalan · son 3 ay">
          <ul>{stats.topLate.map((x) => <Row key={x.id} l={`${x.name} · ${x.dept}`} r={`${x.late} kez · ${Math.round(x.lateMin / 60 * 10) / 10} sa`} href={`/personel/${x.id}`} />)}</ul>
          {stats.topLate.length === 0 && <p className="text-sm text-muted">Geç kalan yok.</p>}
        </Card>
      </div>

      <Card title={`Bölümler · ${periodLabel(period)}`}>
        <div className="hidden md:grid grid-cols-[1.6fr_.6fr_1fr_1fr_.8fr_.9fr] gap-2 text-xs text-muted px-1"><span>Bölüm</span><span className="text-right">Kişi</span><span className="text-right">Maliyet</span><span className="text-right">Kişi başı</span><span className="text-right">Mesai</span><span className="text-right">Devamsızlık*</span></div>
        <ul className="divide-y divide-[#EEF2F6]">
          {depts.map(([d, g]) => {
            const ab = stats.deptAbsence.get(d);
            const rate = ab && ab.expected ? Math.round((ab.absent / ab.expected) * 1000) / 10 : 0;
            return (
              <li key={d}>
                <Link href={`/personel?bolum=${encodeURIComponent(d)}`} className="grid grid-cols-2 md:grid-cols-[1.6fr_.6fr_1fr_1fr_.8fr_.9fr] gap-x-2 gap-y-0.5 py-2.5 px-1 text-sm active:bg-[#F2F6FB]">
                  <span className="font-semibold text-brand-700 col-span-2 md:col-span-1">{d}</span>
                  <span className="md:text-right num text-muted md:text-ink"><span className="md:hidden">Kişi </span>{g.people}</span>
                  <span className="text-right num">{formatTL(g.cost)}</span>
                  <span className="md:text-right num text-muted md:text-ink"><span className="md:hidden">Kişi başı </span>{formatTL(g.people ? Math.round(g.cost / g.people) : 0)}</span>
                  <span className="text-right num text-muted md:text-ink"><span className="md:hidden">Mesai </span>{Math.round(g.otMin / 6) / 10} sa</span>
                  <span className={`md:text-right num ${rate >= 5 ? "text-bad font-semibold" : "text-muted md:text-ink"}`}><span className="md:hidden">Devamsızlık </span>%{rate.toLocaleString("tr-TR")}</span>
                </Link>
              </li>
            );
          })}
        </ul>
        <p className="text-xs text-muted">*Devamsızlık: bu ay bugüne kadar, çalışılması gereken günlerde habersiz gelinmeyen günlerin oranı. Maliyet: net hakediş + SGK + vergi.</p>
      </Card>

      {(cele.anniversaries.length > 0 || cele.birthdays.length > 0) && (
        <Card title="Yaklaşan özel günler">
          <ul>
            {cele.anniversaries.map((x) => <Row key={`a${x.id}`} l={`🎖 ${x.name} · ${x.dept} · ${x.years}. yılı`} r={x.inDays === 0 ? "bugün" : `${x.inDays} gün sonra`} href={`/personel/${x.id}`} />)}
            {cele.birthdays.map((x) => <Row key={`b${x.id}`} l={`🎂 ${x.name} · ${x.dept} · doğum günü`} r={x.inDays === 0 ? "bugün" : `${x.inDays} gün sonra`} href={`/personel/${x.id}`} />)}
          </ul>
        </Card>
      )}
    </>
  );
}

/* ================================================================ Risk */
async function Risks({ sb, today, cur, emps }: { sb: SB; today: string; cur: string; emps: EmpLite[] }) {
  const m = await loadMoney(sb, cur);
  const r = await loadRisks(sb, today, emps, m.garnishment);
  return (
    <>
      <div className="rounded-[14px] bg-brand-900 text-white p-4 flex flex-col gap-3">
        <div className="text-[11px] uppercase tracking-wide text-white/70">Bugün herkes tazminatlı ayrılsa</div>
        <div className="grid grid-cols-2 gap-3">
          <div><div className="text-xs text-white/70">Resmi ücrete göre</div><div className="num text-xl font-bold">{formatTL(r.kidemOfficial + r.ihbarOfficial)}</div><div className="text-[11px] text-white/70">kıdem {formatTL(r.kidemOfficial)} · ihbar {formatTL(r.ihbarOfficial)}</div></div>
          <div><div className="text-xs text-white/70">Gerçek ücrete göre (elden dâhil)</div><div className="num text-xl font-bold text-[#FFD27A]">{formatTL(r.kidemReal + r.ihbarReal)}</div><div className="text-[11px] text-white/70">kıdem {formatTL(r.kidemReal)} · ihbar {formatTL(r.ihbarReal)}</div></div>
        </div>
        <p className="text-[11px] text-white/70">Dava hâlinde mahkeme elden ödenen dâhil gerçek ücreti esas alır; aradaki fark açık risktir. Tahmindir: kıdem tavanı (Mevzuat bülteninden) uygulandı; yemek/yol gibi ek ödemeler ve fesih nedeni dikkate alınmadı.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card title="En yüksek kıdem yükü">
          <ul>{r.topKidem.map((x) => <Row key={x.id} l={`${x.name} · ${Math.floor(x.years)} yıl ${Math.round((x.years % 1) * 12)} ay`} r={`${formatTL(x.real)}`} href={`/personel/${x.id}`} />)}</ul>
          <p className="text-xs text-muted">Gerçek ücrete göre; resmi ücrete göre tutarlar daha düşüktür.</p>
        </Card>
        <Card title="Kullanılmamış yıllık izin">
          <div className="flex items-baseline gap-3"><span className="num text-2xl font-bold text-brand-800">{r.leaveDays.toLocaleString("tr-TR")} gün</span><span className="num text-sm text-muted">≈ {formatTL(r.leaveCost)}</span></div>
          <ul>{r.topLeave.map((x) => <Row key={x.id} l={`${x.name} · ${x.dept}`} r={`${x.days} gün · ${formatTL(x.cost)}`} href={`/personel/${x.id}`} />)}</ul>
          {r.leaveUnknown > 0 && <p className="text-xs rounded-lg bg-[#FFF4E0] text-[#8A5A00] p-2">⚠ {r.leaveUnknown} kişinin (2+ yıllık) geçmiş izin kullanımı ya da devri sisteme girilmemiş; bu kişilerin kalan günü olduğundan yüksek görünür. Personel kartı → İzin → devir/düzeltme ile girin.</p>}
          <p className="text-xs text-muted">Ayrılışta ücreti ödenmek zorundadır. Tutar anlaşılan net ücret / 30 × kalan gün.</p>
        </Card>
        <Card title="Yıllık 270 saat mesai sınırı">
          <ul>{r.overtime.map((x) => <Row key={x.id} l={`${x.name} · ${x.dept}`} r={`${x.hours.toLocaleString("tr-TR")} sa ${x.hours >= 270 ? "⛔ aştı" : "⚠"}`} href={`/personel/${x.id}`} />)}</ul>
          {r.overtime.length === 0 && <p className="text-sm text-muted">✓ Bu yıl 200 saati geçen yok.</p>}
          <p className="text-xs text-muted">İş Kanunu 41: yılda en çok 270 saat fazla mesai. 200 saati geçenler listelenir.</p>
        </Card>
        <Card title="Süresi dolan belgeler" action={<Link href="/isg" className="text-sm font-semibold text-brand-700">İSG →</Link>}>
          <div className="grid grid-cols-3 gap-2">
            <Mini label="Süresi geçmiş" value={String(r.docs.expired)} warn={r.docs.expired > 0} />
            <Mini label="30 gün içinde" value={String(r.docs.soon)} warn={r.docs.soon > 0} />
            <Mini label="Hiç yok" value={String(r.docs.missing)} warn={r.docs.missing > 0} />
          </div>
          <ul>{r.docs.list.map((x, i) => <Row key={`${x.id}${i}`} l={`${x.name} · ${x.what}`} r={x.when} href={`/personel/${x.id}`} />)}</ul>
        </Card>
        <Card title="Deneme süresi bitiyor">
          <ul>{r.probation.map((x) => <Row key={x.id} l={`${x.name} · ${x.dept} · karar bekliyor`} r={x.inDays < 0 ? `${-x.inDays} gün önce bitti` : x.inDays === 0 ? "bugün" : `${formatDate(x.ends)} · ${x.inDays} gün`} href={`/uyum/${x.id}`} />)}</ul>
          {r.probation.length === 0 && <p className="text-sm text-muted">Önümüzdeki 3 hafta içinde deneme süresi biten yok.</p>}
          <p className="text-xs text-muted">2 aylık yasal deneme süresi; bu süre içinde bildirimsiz ve tazminatsız fesih mümkündür. Karar vermek için son fırsat.</p>
        </Card>
        <Card title="Tek kişiye bağlı işler" action={<Link href="/yetkinlik" className="text-sm font-semibold text-brand-700">Matris →</Link>}>
          <ul>{r.skillRisk.map((x) => <Row key={x.skill} l={x.skill} r={x.holder ? `yalnız ${x.holder}` : "kimse yok ⛔"} />)}</ul>
          {r.skillRisk.length === 0 && <p className="text-sm text-muted">Beceri matrisi girildikçe, yalnız bir kişinin bağımsız yapabildiği işler burada listelenir.</p>}
          <p className="text-xs text-muted">Bu kişi ayrılır ya da raporlu olursa iş durur; yedek yetiştirin.</p>
        </Card>
        <Card title="İcra ve nafaka" action={<Link href="/icra" className="text-sm font-semibold text-brand-700">Dosyalar →</Link>}>
          <div className="grid grid-cols-3 gap-2">
            <Mini label="Personel" value={String(r.garnish.people)} />
            <Mini label="Dosya" value={`${r.garnish.enforcement} icra · ${r.garnish.alimony} nafaka`} />
            <Mini label="Bu ay kesinti" value={formatTL(r.garnish.monthly)} />
          </div>
        </Card>
      </div>
    </>
  );
}

/* ================================================================ Parçalar */
function TodayStrip({ t, open }: { t: TodayData; open?: boolean }) {
  const pct = t.expected ? Math.round((t.present.length / t.expected) * 100) : 0;
  const hot = t.depts.filter((d) => d.missing >= 3 || (d.expected > 0 && d.missing >= 2 && d.missing / d.expected >= 0.3));
  const List = ({ title, xs }: { title: string; xs: TodayData["absent"] }) => xs.length ? (
    <details className="group" open={open && title === "Gelmeyenler"}>
      <summary className="cursor-pointer list-none flex justify-between text-sm font-semibold text-brand-700 py-1.5"><span>{title} ({xs.length})</span><span className="text-muted group-open:rotate-90 transition-transform">›</span></summary>
      <ul>{xs.map((p) => <Row key={p.id} l={`${p.name} · ${p.dept}`} r={p.note ?? ""} href={`/personel/${p.id}`} />)}</ul>
    </details>
  ) : null;
  return (
    <section className="bg-white border border-line rounded-[14px] p-4 flex flex-col gap-3" aria-label="Bugün">
      <div className="flex items-baseline justify-between">
        <h2 className="font-display text-base font-semibold text-brand-800">Bugün</h2>
        <span className="text-sm text-muted">doluluk <b className={`num text-lg ${pct < 85 ? "text-bad" : "text-ok"}`}>%{pct}</b></span>
      </div>
      <div className="h-2 rounded-full bg-[#EEF2F6] overflow-hidden" role="img" aria-label={`Doluluk yüzde ${pct}`}><div className={`h-full rounded-full ${pct < 85 ? "bg-[#D64545]" : "bg-[#1FA971]"}`} style={{ width: `${pct}%` }} /></div>
      <div className="grid grid-cols-4 gap-2 text-center">
        {([["Gelen", t.present.length, false], ["Gelmeyen", t.absent.length, t.absent.length > 0], ["Geç kalan", t.late.length, t.late.length > 0], ["İzinli", t.leave.length, false]] as const).map(([l, v, w]) => (
          <div key={l} className={`rounded-xl py-2 ${w ? "bg-[#FDECEA]" : "bg-[#F2F6FB]"}`}><div className={`num text-xl font-bold ${w ? "text-bad" : "text-brand-800"}`}>{v}</div><div className="text-[11px] text-muted">{l}</div></div>
        ))}
      </div>
      {hot.length > 0 && (
        <div className="flex flex-wrap gap-2">{hot.map((d) => <span key={d.dept} className="text-xs font-semibold rounded-full bg-[#FDECEA] text-bad px-2.5 py-1">{d.dept}: {d.missing} kişi eksik</span>)}</div>
      )}
      <div className="flex flex-col divide-y divide-[#EEF2F6]">
        <List title="Gelmeyenler" xs={t.absent} />
        <List title="Geç kalanlar" xs={t.late} />
        <List title="İzinli / raporlu" xs={t.leave} />
      </div>
      <p className="text-[11px] text-muted">Anlık okutmalara göre; vardiyası henüz başlamayanlar gelmeyen görünebilir.</p>
    </section>
  );
}

function pctChange(a: number, b: number) { return b ? Math.round(((a - b) / b) * 1000) / 10 : null; }
function Delta({ now, before, label }: { now: number; before: number; label: string }) {
  const d = pctChange(now, before);
  if (d === null) return <span className="text-white/60">{label}: veri yok</span>;
  return <span>{label}: <b className={d > 0 ? "text-[#FFB4A8]" : "text-[#9BE3C1]"}>{d > 0 ? "▲" : d < 0 ? "▼" : "•"} %{Math.abs(d).toLocaleString("tr-TR")}</b> <span className="text-white/60">({formatTL(before)})</span></span>;
}
function CostHero({ m, prev, lastYear }: { m: MoneyData; prev: MoneyData; lastYear?: MoneyData }) {
  return (
    <section className="rounded-[14px] bg-brand-900 text-white p-4 flex flex-col gap-3" aria-label="Bu ayın maliyeti">
      <div className="flex justify-between items-baseline gap-2">
        <div className="text-[11px] uppercase tracking-wide text-white/70">{periodLabel(m.period)} toplam personel maliyeti</div>
        <Link href={`/patron?sekme=para${m.period !== currentPeriod() ? `&donem=${m.period}` : ""}`} className="text-xs font-semibold text-white/80">Ayrıntı →</Link>
      </div>
      <div className="num font-display text-3xl font-bold leading-none">{formatTL(m.totalCost)}</div>
      <div className="text-xs flex flex-col gap-0.5">
        <Delta now={m.totalCost} before={prev.totalCost} label="Geçen aya göre" />
        {lastYear && <Delta now={m.totalCost} before={lastYear.totalCost} label="Geçen yıl aynı ay" />}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-1 border-t border-white/15">
        {([["Banka (resmi net)", m.officialNet], ["Elden", m.cashNet], ["SGK + vergi", m.sgk + m.tax], ["Personele kalan", m.remainBank + m.remainCash]] as const).map(([l, v]) => (
          <div key={l}><div className="text-[11px] text-white/70">{l}</div><div className="num font-bold">{formatTL(v)}</div></div>
        ))}
      </div>
      <div className="text-[11px] text-white/70">{m.people} kişi · kalan: banka {formatTL(m.remainBank)} · elden {formatTL(m.remainCash)}</div>
    </section>
  );
}

const STATUS: Record<CalItem["status"], [string, string]> = { paid: ["✓ Ödendi", "bg-[#E6F4EC] text-ok"], late: ["Gecikti", "bg-[#FDECEA] text-bad"], due: ["Bekliyor", "bg-[#FFF4E0] text-[#8A5A00]"], info: ["Tahmini", "bg-[#EEF2F6] text-muted"] };
const DAY = ["Paz", "Pzt", "Sal", "Çar", "Per", "Cum", "Cmt"];
function WeekTotal({ items }: { items: CalItem[] }) {
  const sum = items.reduce((a, i) => a + i.amount, 0);
  return <div className="rounded-xl bg-[#F2F6FB] px-3 py-2 flex justify-between items-baseline"><span className="text-sm text-muted">Bu hafta çıkacak (gecikenler dâhil)</span><b className="num text-lg text-brand-800">{formatTL(sum)}</b></div>;
}
function CalendarList({ items, today, empty }: { items: CalItem[]; today: string; empty: string }) {
  if (!items.length) return <p className="text-sm text-muted">{empty}</p>;
  const groups = new Map<string, CalItem[]>();
  for (const i of items) groups.set(i.date, [...(groups.get(i.date) ?? []), i]);
  return (
    <ol className="flex flex-col gap-3">
      {[...groups.entries()].map(([d, xs]) => {
        const dt = new Date(d + "T12:00:00Z");
        const rel = d === today ? "bugün" : d === addDays(today, 1) ? "yarın" : d < today ? "geçti" : "";
        return (
          <li key={d} className="flex gap-3">
            <div className={`w-14 shrink-0 rounded-xl text-center py-1.5 ${d < today ? "bg-[#FDECEA]" : d === today ? "bg-brand-800 text-white" : "bg-[#F2F6FB]"}`}>
              <div className="num text-lg font-bold leading-none">{dt.getUTCDate()}</div>
              <div className="text-[10px] uppercase">{periodName(d.slice(0, 7)).slice(0, 3)} · {DAY[dt.getUTCDay()]}</div>
              {rel && <div className="text-[10px] font-semibold">{rel}</div>}
            </div>
            <ul className="flex-1 flex flex-col divide-y divide-[#EEF2F6]">
              {xs.map((i, k) => {
                const [sl, sc] = STATUS[i.status];
                const body = (
                  <>
                    <div className="min-w-0"><div className="text-sm font-semibold text-ink truncate">{i.title}</div><div className="text-xs text-muted truncate">{i.detail}</div></div>
                    <div className="text-right shrink-0"><div className="num text-sm font-bold">{formatTL(i.amount)}</div><span className={`text-[10px] font-semibold rounded-full px-2 py-0.5 ${sc}`}>{sl}</span></div>
                  </>
                );
                return <li key={k} className="py-1.5">{i.href ? <Link href={i.href} className="flex justify-between gap-2">{body}</Link> : <div className="flex justify-between gap-2">{body}</div>}</li>;
              })}
            </ul>
          </li>
        );
      })}
    </ol>
  );
}

function ApprovalsCard({ a, today }: { a: Approvals; today: string }) {
  const total = approvalCount(a);
  const who = (x: { employees?: unknown }) => { const e = x.employees as { first_name: string; last_name: string; departments?: { name: string } | null } | null; return e ? `${nameOf(e)}${e.departments?.name ? ` · ${e.departments.name}` : ""}` : "—"; };
  const btn = "h-10 px-3 rounded-lg text-sm font-semibold";
  const ok = `${btn} bg-brand-700 text-white`;
  const no = `${btn} border border-[#D5DEE8] bg-white text-bad`;
  const sel = "h-10 rounded-lg border border-[#D5DEE8] px-2 bg-white text-sm";
  const Item = ({ tag, title, sub, children }: { tag: string; title: string; sub: string; children: React.ReactNode }) => (
    <li className="py-3 flex flex-col gap-2">
      <div className="flex gap-2 items-start"><span className="text-[10px] font-bold uppercase tracking-wide rounded bg-[#EAF2FB] text-brand-700 px-1.5 py-0.5 mt-0.5">{tag}</span><div className="min-w-0"><div className="text-sm font-semibold">{title}</div><div className="text-xs text-muted">{sub}</div></div></div>
      <div className="flex flex-wrap gap-2">{children}</div>
    </li>
  );
  return (
    <Card title={`Onayımı bekleyenler${total ? ` · ${total}` : ""}`} action={<Link href="/talepler" className="text-sm font-semibold text-brand-700">Tümü →</Link>}>
      {total === 0 && <p className="text-sm text-muted">✓ Bekleyen talep yok.</p>}
      <ul className="divide-y divide-[#EEF2F6]">
        {a.adv.map((x) => (
          <Item key={x.id} tag="Avans" title={`${who(x)} · ${formatTL(Number(x.amount))}`} sub={`${formatDate(x.created_at)}${x.reason ? ` · ${x.reason}` : ""}`}>
            <form action={decideAdvance} className="flex flex-wrap gap-2">
              <input type="hidden" name="id" value={x.id} /><input type="hidden" name="date" value={today} />
              <select name="channel" defaultValue="CASH" aria-label="Ödeme kanalı" className={sel}><option value="CASH">Elden</option><option value="BANK">Banka</option></select>
              <PendingSubmit name="decision" value="approve" className={ok}>Onayla</PendingSubmit>
              <PendingSubmit name="decision" value="reject" className={no}>Reddet</PendingSubmit>
            </form>
          </Item>
        ))}
        {a.leave.map((x) => (
          <Item key={x.id} tag="İzin" title={`${who(x)} · ${(x.leave_types as unknown as { name: string } | null)?.name ?? "İzin"}`} sub={`${formatDate(x.start_date)}${x.end_date !== x.start_date ? ` – ${formatDate(x.end_date)}` : ""} · ${x.hours ? `${x.hours} saat` : `${x.days} gün`}${x.note ? ` · ${x.note}` : ""}`}>
            <form action={decideLeave}><input type="hidden" name="id" value={x.id} /><input type="hidden" name="status" value="approved" /><PendingSubmit className={ok}>Onayla</PendingSubmit></form>
            <form action={decideLeave}><input type="hidden" name="id" value={x.id} /><input type="hidden" name="status" value="rejected" /><PendingSubmit className={no}>Reddet</PendingSubmit></form>
          </Item>
        ))}
        {a.ot.map((x) => (
          <Item key={x.id} tag="Mesai" title={`${who(x)} · ${Math.floor(x.minutes / 60)} sa ${x.minutes % 60 ? `${x.minutes % 60} dk` : ""}`} sub={`${formatDate(x.work_date)} · ×${x.rate}${x.note ? ` · ${x.note}` : ""}`}>
            <form action={approveOvertime} className="flex flex-wrap gap-2">
              <input type="hidden" name="item" value={`${x.employee_id}|${x.work_date}|${x.minutes}|${x.rate}`} />
              <select name="pay_side" defaultValue="BOTH" aria-label="Ödeme şekli" className={sel}><option value="BOTH">Resmi + elden</option><option value="OFFICIAL">Bordrodan</option><option value="CASH">Elden</option></select>
              <PendingSubmit name="decision" value="approve" className={ok}>Onayla</PendingSubmit>
              <PendingSubmit name="decision" value="reject" className={no}>Reddet</PendingSubmit>
            </form>
          </Item>
        ))}
        {a.meal.map((x) => (
          <Item key={x.id} tag="Yemek" title={`${(x.departments as unknown as { name: string } | null)?.name ?? "Bölüm"} · ${x.head_count} kişi`} sub={`${formatDate(x.on_date)}${x.note ? ` · ${x.note}` : ""}`}>
            <form action={decideMeal.bind(null, "approved")}><input type="hidden" name="id" value={x.id} /><PendingSubmit className={ok}>Onayla</PendingSubmit></form>
            <form action={decideMeal.bind(null, "rejected")}><input type="hidden" name="id" value={x.id} /><PendingSubmit className={no}>Reddet</PendingSubmit></form>
          </Item>
        ))}
        {a.punch.map((x) => (
          <Item key={x.id} tag="Okutma" title={`${who(x)} · ${x.direction === "IN" ? "giriş" : "çıkış"} ${String(x.at_time).slice(0, 5)}`} sub={`${formatDate(x.on_date)}${x.note ? ` · ${x.note}` : ""}`}>
            <form action={decidePunchRequest.bind(null, "approved")}><input type="hidden" name="id" value={x.id} /><PendingSubmit className={ok}>Onayla</PendingSubmit></form>
            <form action={decidePunchRequest.bind(null, "rejected")}><input type="hidden" name="id" value={x.id} /><PendingSubmit className={no}>Reddet</PendingSubmit></form>
          </Item>
        ))}
        {a.prof.map((x) => (
          <Item key={x.id} tag="Özlük" title={who(x)} sub={`${Object.keys((x.changes as Record<string, unknown>) ?? {}).length} alan değişikliği · ${formatDate(x.created_at)}`}>
            <form action={decideProfileChange.bind(null, "approved")}><input type="hidden" name="id" value={x.id} /><PendingSubmit className={ok}>Onayla</PendingSubmit></form>
            <form action={decideProfileChange.bind(null, "rejected")}><input type="hidden" name="id" value={x.id} /><PendingSubmit className={no}>Reddet</PendingSubmit></form>
            <Link href="/talepler" className={`${btn} border border-[#D5DEE8] bg-white text-brand-700 inline-flex items-center`}>Ayrıntı</Link>
          </Item>
        ))}
      </ul>
    </Card>
  );
}

function Mini({ label, value, sub, warn }: { label: string; value: string; sub?: string; warn?: boolean }) {
  return (
    <div className={`rounded-xl border p-3 flex flex-col gap-0.5 ${warn ? "border-[#F2C94C] bg-[#FFF4E0]" : "border-line bg-white"}`}>
      <span className="text-xs text-muted leading-tight">{label}</span>
      <span className={`num font-bold text-lg leading-tight ${warn ? "text-[#8A5A00]" : "text-brand-800"}`}>{value}</span>
      {sub && <span className="text-[11px] text-muted leading-snug">{sub}</span>}
    </div>
  );
}
function Row({ l, r, href }: { l: string; r: string; href?: string }) {
  return <li className="flex flex-wrap justify-between gap-x-3 gap-y-0.5 py-1.5 border-b border-[#EEF2F6] last:border-0 text-sm">{href ? <Link href={href} className="font-semibold text-brand-700 min-w-0">{l}</Link> : <span className="min-w-0">{l}</span>}<span className="num whitespace-nowrap text-right ml-auto">{r}</span></li>;
}

/** Yatay yığılmış kırılım çubuğu + etiketli liste */
function Bars({ parts, total }: { parts: Array<[string, number, string]>; total: number }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex h-3 rounded-full overflow-hidden gap-[2px] bg-white" role="img" aria-label="Maliyet kırılımı">
        {parts.filter(([, v]) => v > 0).map(([l, v, c]) => <div key={l} title={`${l}: ${formatTL(v)}`} style={{ width: `${(v / Math.max(1, total)) * 100}%`, background: c }} />)}
      </div>
      <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1">
        {parts.map(([l, v, c]) => (
          <li key={l} className="flex items-center gap-2 text-sm"><span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: c }} aria-hidden /><span className="text-muted truncate">{l}</span><span className="num ml-auto font-semibold">{formatTL(v)}</span><span className="num text-xs text-muted w-10 text-right">%{total ? Math.round((v / total) * 100) : 0}</span></li>
        ))}
      </ul>
    </div>
  );
}

/** Tek seri sütun grafik (SVG, üzerine gelince değer) */
function TrendChart({ data, fmt }: { data: Array<{ label: string; title: string; value: number; active?: boolean }>; fmt: (v: number) => string }) {
  const W = 600, H = 160, pad = 22, n = data.length;
  const max = Math.max(1, ...data.map((d) => d.value));
  const bw = (W - 8) / n;
  const bar = Math.max(6, Math.min(28, bw - 10));
  const last = [...data].reverse().find((d) => d.value > 0);
  return (
    <svg viewBox={`0 0 ${W} ${H + pad}`} className="w-full h-auto" role="img" aria-label={data.map((d) => d.title).join("; ")}>
      <line x1={0} x2={W} y1={H} y2={H} stroke="#D5DEE8" strokeWidth={1} />
      {data.map((d, i) => {
        const h = d.value > 0 ? Math.max(3, (d.value / max) * (H - 24)) : 0;
        const x = 4 + i * bw + (bw - bar) / 2;
        return (
          <g key={i}>
            <rect x={4 + i * bw} y={0} width={bw} height={H + pad} fill="transparent"><title>{d.title}</title></rect>
            {h > 0 && <path d={`M${x},${H} V${H - h + 4} q0,-4 4,-4 h${bar - 8} q4,0 4,4 V${H} Z`} fill={d.active ? "#0A3D73" : "#7FA7D4"} pointerEvents="none" />}
            {d === last && h > 0 && <text x={x + bar / 2} y={H - h - 6} textAnchor="middle" fontSize={11} fill="#4A5868" pointerEvents="none">{fmt(d.value)}</text>}
            <text x={x + bar / 2} y={H + 15} textAnchor="middle" fontSize={11} fill={d.active ? "#0A3D73" : "#6B7785"} fontWeight={d.active ? 700 : 400} pointerEvents="none">{d.label}</text>
          </g>
        );
      })}
    </svg>
  );
}
