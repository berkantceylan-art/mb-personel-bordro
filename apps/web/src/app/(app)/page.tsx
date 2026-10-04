import Link from "next/link";
import { formatTL } from "@mb/core";
import { Card, PageHeader, PrimaryLink, SecondaryLink, Stat, ChannelChip, TYPE_LABEL } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { currentPeriod, formatDate, getSession, periodLabel } from "@/lib/session";
import { loadCompliance } from "@/lib/compliance";
import { PeriodPicker } from "@/components/PeriodPicker";

type SummaryRow = { employee_id: string; accrued: number | null; paid_bank: number | null; paid_cash: number | null; deductions: number | null; balance: number | null };

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ donem?: string }> }) {
  const s = await getSession();
  const supabase = await createClient();
  const sp = await searchParams;
  const period = sp.donem && /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.donem) ? sp.donem : currentPeriod();
  const isCurrent = period === currentPeriod();

  const [{ count: employeeCount }, { data: summary }, { data: moves }, { data: depts }, { data: periodRows }] = await Promise.all([
    supabase.from("employees").select("id", { count: "exact", head: true }).eq("status", "active"),
    supabase.from("ledger_period_summary").select("employee_id, accrued, paid_bank, paid_cash, deductions, balance").eq("period", period),
    supabase
      .from("ledger_entries")
      .select("id, entry_date, type, channel, amount, employees(first_name, last_name)")
      .is("voided_at", null)
      .eq("period", period)
      .order("entry_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(8),
    supabase.from("employees").select("department_id, departments(name)").eq("status", "active"),
    supabase.from("payroll_periods").select("period").order("period", { ascending: false }),
  ]);
  const periodOptions = [...new Set([currentPeriod(), ...(periodRows ?? []).map((r) => r.period as string)])];

  const canSeeHealth = ["owner", "hr", "safety"].includes(s.role);
  const [isg, health, { count: pendingLeave }, { count: pendingOt }] = await Promise.all([
    loadCompliance(supabase, "TRAINING"),
    canSeeHealth ? loadCompliance(supabase, "HEALTH") : Promise.resolve(null),
    supabase.from("leave_requests").select("id", { count: "exact", head: true }).eq("status", "pending"),
    supabase.from("overtime_records").select("id", { count: "exact", head: true }).eq("status", "pending"),
  ]);
  const urgent = [...isg.alerts.map((a) => ({ ...a, href: "/isg" })), ...(health?.alerts ?? []).map((a) => ({ ...a, href: "/saglik" }))]
    .filter((a) => a.level !== "MISSING")
    .sort((a, b) => (a.daysLeft ?? 0) - (b.daysLeft ?? 0))
    .slice(0, 6);
  const rows = (summary ?? []) as SummaryRow[];
  const n = (v: number | null) => Number(v ?? 0);
  const total = {
    accrued: rows.reduce((a, r) => a + n(r.accrued), 0),
    bank: rows.reduce((a, r) => a + n(r.paid_bank), 0),
    cash: rows.reduce((a, r) => a + n(r.paid_cash), 0),
    balance: rows.reduce((a, r) => a + n(r.balance), 0),
  };
  const paid = total.bank + total.cash;
  const pct = (v: number) => (total.accrued > 0 ? Math.min(100, Math.round((v / total.accrued) * 100)) : 0);

  const deptCount = new Map<string, number>();
  for (const e of depts ?? []) {
    const name = (e.departments as unknown as { name: string } | null)?.name ?? "Bölümsüz";
    deptCount.set(name, (deptCount.get(name) ?? 0) + 1);
  }

  return (
    <>
      <PageHeader
        title="Gösterge Paneli"
        subtitle={`Dönem: ${periodLabel(period)}${isCurrent ? " (içinde bulunulan ay)" : ""}`}
        actions={
          <div className="flex gap-2 flex-wrap items-center">
            <PeriodPicker value={period} options={periodOptions} />
            <SecondaryLink href="/ice-aktar">Excel&apos;den aktar</SecondaryLink>
            {(s.role === "owner" || s.role === "accountant") && <PrimaryLink href="/odemeler/yeni">+ Hızlı Avans / Ödeme</PrimaryLink>}
          </div>
        }
      />
      <div className="p-4 md:p-8 flex flex-col gap-6 max-w-[1240px]">
        <section className="grid gap-3 md:gap-4 grid-cols-2 md:grid-cols-[repeat(auto-fit,minmax(220px,1fr))]">
          <Stat label={`${periodLabel(period)} toplam hakediş`} value={formatTL(total.accrued)} sub={`${rows.length} personelde hakediş kaydı`} />
          <Stat label="Şu ana kadar ödenen" value={formatTL(paid)} sub={`Banka ${formatTL(total.bank)} · Elden ${formatTL(total.cash)}`} />
          <Stat label="Kalan ödenecek" value={formatTL(total.balance)} sub={<Link href={`/ay-sonu?donem=${period}`} className="font-semibold text-brand-700">Ay sonu adımları →</Link>} />
          <Stat label="Aktif personel" value={String(employeeCount ?? 0)} sub={`${deptCount.size} bölüm`} />
        </section>

        <Card title={`${periodLabel(period)} ödeme durumu`}>
          <div className="flex h-[18px] rounded-full overflow-hidden bg-[#E9EEF4]" role="img" aria-label={`Banka yüzde ${pct(total.bank)}, elden yüzde ${pct(total.cash)}`}>
            <div style={{ width: `${pct(total.bank)}%` }} className="bg-brand-700" />
            <div style={{ width: `${pct(total.cash)}%` }} className="bg-accent" />
          </div>
          <div className="flex flex-wrap gap-7 text-[13px]">
            <span className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-sm bg-brand-700" />Banka <b className="num">{formatTL(total.bank)}</b></span>
            <span className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-sm bg-accent" />Elden <b className="num">{formatTL(total.cash)}</b></span>
            <span className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-sm bg-[#E9EEF4] border border-[#C5D0DC]" />Kalan <b className="num">{formatTL(total.balance)}</b></span>
          </div>
        </Card>

        <Card title="Uyarılar" action={<span className="text-xs text-muted">30 / 15 / 7 gün kala</span>}>
          <div className="flex flex-wrap gap-2 text-xs font-semibold">
            <Link href="/isg" className="px-2.5 py-1.5 rounded-full bg-bad-bg text-bad">İSG: {isg.counts.expired + isg.counts.d7} acil · {isg.counts.d15 + isg.counts.d30} yaklaşan · {isg.counts.missing} eksik</Link>
            {health && <Link href="/saglik" className="px-2.5 py-1.5 rounded-full bg-warn-bg text-warn">Sağlık: {health.counts.expired + health.counts.d7} acil · {health.counts.d15 + health.counts.d30} yaklaşan · {health.counts.missing} eksik</Link>}
            {(pendingLeave ?? 0) > 0 && <Link href="/izin" className="px-2.5 py-1.5 rounded-full bg-[#E7F1FB] text-brand-700">Onay bekleyen izin: {pendingLeave}</Link>}
            {(pendingOt ?? 0) > 0 && <Link href="/fazla-mesai" className="px-2.5 py-1.5 rounded-full bg-[#E7F1FB] text-brand-700">Onay bekleyen FM: {pendingOt}</Link>}
          </div>
          {urgent.map((a) => (
            <Link key={`${a.href}${a.employeeId}${a.typeId}`} href={a.href} className="flex gap-3 items-center p-2.5 rounded-lg bg-[#F7F9FB] hover:bg-[#EEF2F6] text-[13px]">
              <span className={`text-[11px] font-bold px-2 py-1 rounded-md ${a.daysLeft !== null && a.daysLeft <= 7 ? "bg-bad-bg text-bad" : "bg-warn-bg text-warn"}`}>{a.daysLeft !== null && a.daysLeft < 0 ? "Geçti" : `${a.daysLeft} gün`}</span>
              <span className="flex-1"><b>{a.name}</b> · {a.typeName}</span>
              <span className="num text-xs text-muted">{a.expiresOn ? formatDate(a.expiresOn) : ""}</span>
            </Link>
          ))}
          {urgent.length === 0 && <p className="text-sm text-ok">Süresi yaklaşan eğitim veya muayene yok.</p>}
        </Card>

        <div className="grid gap-6 grid-cols-[repeat(auto-fit,minmax(min(340px,100%),1fr))]">
          <Card title={`Son hareketler · ${periodLabel(period)}`} action={<Link href={`/donemler/${period}`} className="text-[13px] font-semibold text-brand-700">Dönem ayrıntısı →</Link>}>
            <div className="overflow-x-auto">
              <table className="w-full text-[13px] min-w-[480px]">
                <thead>
                  <tr className="text-left text-xs text-muted">
                    <th className="py-2 px-1.5 font-semibold border-b border-line">Tarih</th>
                    <th className="py-2 px-1.5 font-semibold border-b border-line">Personel</th>
                    <th className="py-2 px-1.5 font-semibold border-b border-line">Tür</th>
                    <th className="py-2 px-1.5 font-semibold border-b border-line">Kanal</th>
                    <th className="py-2 px-1.5 font-semibold border-b border-line text-right">Tutar</th>
                  </tr>
                </thead>
                <tbody>
                  {(moves ?? []).map((m) => {
                    const emp = m.employees as unknown as { first_name: string; last_name: string } | null;
                    return (
                      <tr key={m.id}>
                        <td className="num py-2.5 px-1.5 border-b border-[#EEF2F6] text-muted">{formatDate(m.entry_date)}</td>
                        <td className="py-2.5 px-1.5 border-b border-[#EEF2F6] font-semibold">{emp ? `${emp.first_name} ${emp.last_name}` : "—"}</td>
                        <td className="py-2.5 px-1.5 border-b border-[#EEF2F6]">{TYPE_LABEL[m.type]}</td>
                        <td className="py-2.5 px-1.5 border-b border-[#EEF2F6]"><ChannelChip channel={m.channel} credit={["ACCRUAL", "BONUS", "OVERTIME"].includes(m.type)} /></td>
                        <td className="num py-2.5 px-1.5 border-b border-[#EEF2F6] text-right font-semibold">{formatTL(Number(m.amount))}</td>
                      </tr>
                    );
                  })}
                  {(moves ?? []).length === 0 && (
                    <tr><td colSpan={5} className="py-6 text-center text-muted">Bu dönemde hareket yok.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>

          <Card title="Bölümlere göre personel" action={<Link href="/personel" className="text-[13px] font-semibold text-brand-700">Personel listesi →</Link>}>
            {[...deptCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([name, c]) => (
              <div key={name} className="grid grid-cols-[140px_1fr_40px] items-center gap-3 text-[13px]">
                <span className="font-semibold truncate">{name}</span>
                <div className="h-2.5 bg-[#EEF2F6] rounded-full overflow-hidden">
                  <div className="h-full bg-brand-700 rounded-full" style={{ width: `${Math.round((c / Math.max(1, employeeCount ?? 1)) * 100)}%` }} />
                </div>
                <span className="num text-right">{c}</span>
              </div>
            ))}
            {deptCount.size === 0 && <p className="text-muted text-sm">Personel eklemek için Excel listesini içe aktarın.</p>}
          </Card>
        </div>
      </div>
    </>
  );
}
