import { formatTL } from "@mb/core";
import { Card, ChannelChip, Stat, TYPE_LABEL } from "@/components/ui";
import { PeriodPicker } from "@/components/PeriodPicker";
import { currentPeriod, formatDate, periodLabel } from "@/lib/session";
import { me, MyHeader, NotLinked, td } from "../_shared";

export default async function MyLedgerPage({ searchParams }: { searchParams: Promise<{ donem?: string }> }) {
  const { supabase, me: e } = await me();
  if (!e) return <NotLinked title="Hesap hareketlerim" />;
  const sp = await searchParams;
  const period = sp.donem && /^\d{4}-\d{2}$/.test(sp.donem) ? sp.donem : currentPeriod();
  const [{ data: sum }, { data: entries }, { data: periods }] = await Promise.all([
    supabase.from("ledger_period_summary").select("accrued, paid_bank, paid_cash, deductions, balance").eq("employee_id", e.id).eq("period", period).maybeSingle(),
    supabase.from("ledger_entries").select("id, entry_date, type, channel, amount, note").eq("employee_id", e.id).eq("period", period).is("voided_at", null).order("entry_date", { ascending: false }).limit(200),
    supabase.from("ledger_entries").select("period").eq("employee_id", e.id).is("voided_at", null),
  ]);
  const n = (v: number | null | undefined) => Number(v ?? 0);
  const options = [...new Set([currentPeriod(), ...(periods ?? []).map((p) => p.period as string)])].sort().reverse();
  const credit = (t: string) => ["ACCRUAL", "BONUS", "OVERTIME", "ADJUSTMENT"].includes(t);
  return (
    <>
      <MyHeader title="Hesap hareketlerim" subtitle={periodLabel(period)} />
      <div className="p-4 md:p-6 flex flex-col gap-4 max-w-[760px]">
        <PeriodPicker value={period} options={options} />
        <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
          <Stat label="Hakediş" value={formatTL(n(sum?.accrued))} />
          <Stat label="Ödenen" value={formatTL(n(sum?.paid_bank) + n(sum?.paid_cash))} sub={`Banka ${formatTL(n(sum?.paid_bank))} · Elden ${formatTL(n(sum?.paid_cash))}`} />
          <Stat label="Kesinti" value={formatTL(n(sum?.deductions))} />
          <Stat label="Kalan" value={formatTL(n(sum?.balance))} />
        </div>
        <Card>
          <div className="overflow-x-auto -mx-1 px-1">
            <table className="w-full text-sm min-w-[340px]">
              <tbody>
                {(entries ?? []).map((x) => (
                  <tr key={x.id}>
                    <td className={`${td} text-muted num whitespace-nowrap`}>{formatDate(x.entry_date)}</td>
                    <td className={td}>{TYPE_LABEL[x.type] ?? x.type}{x.note && <div className="text-xs text-muted">{x.note}</div>}</td>
                    <td className={td}><ChannelChip channel={x.channel} credit={credit(x.type)} /></td>
                    <td className={`${td} text-right num font-semibold ${credit(x.type) ? "text-ok" : ""}`}>{credit(x.type) ? "+" : "−"}{formatTL(Number(x.amount))}</td>
                  </tr>
                ))}
                {(entries ?? []).length === 0 && <tr><td colSpan={4} className="py-6 text-center text-muted">Bu ay hareket yok.</td></tr>}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </>
  );
}
