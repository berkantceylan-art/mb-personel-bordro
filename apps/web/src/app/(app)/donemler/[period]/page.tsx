import Link from "next/link";
import { redirect } from "next/navigation";
import { formatTL } from "@mb/core";
import { PageHeader, Stat } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { canManagePay, getSession, periodLabel } from "@/lib/session";

type Row = { employee_id: string; accrued: number | null; paid_bank: number | null; paid_cash: number | null; deductions: number | null; balance: number | null };

export default async function PeriodDetailPage({ params, searchParams }: { params: Promise<{ period: string }>; searchParams: Promise<{ bolum?: string }> }) {
  const { period } = await params;
  const { bolum } = await searchParams;
  const s = await getSession();
  if (!canManagePay(s.role) || !/^\d{4}-\d{2}$/.test(period)) redirect("/donemler");
  const supabase = await createClient();
  const [{ data: sums }, { data: emps }] = await Promise.all([
    supabase.from("ledger_period_summary").select("employee_id, accrued, paid_bank, paid_cash, deductions, balance").eq("period", period),
    supabase.from("employees").select("id, first_name, last_name, card_no, departments(name)"),
  ]);
  const empById = new Map((emps ?? []).map((e) => [e.id, e]));
  const n = (v: number | null) => Number(v ?? 0);
  const rows = ((sums ?? []) as Row[])
    .map((r) => {
      const e = empById.get(r.employee_id);
      return {
        ...r,
        name: e ? `${e.first_name} ${e.last_name}` : "—",
        dept: (e?.departments as unknown as { name: string } | null)?.name ?? "Bölümsüz",
        cardNo: e?.card_no ?? "",
      };
    })
    .filter((r) => !bolum || r.dept === bolum)
    .sort((a, b) => a.dept.localeCompare(b.dept, "tr") || a.name.localeCompare(b.name, "tr"));
  const depts = [...new Set(((sums ?? []) as Row[]).map((r) => (empById.get(r.employee_id)?.departments as unknown as { name: string } | null)?.name ?? "Bölümsüz"))].sort((a, b) => a.localeCompare(b, "tr"));
  const t = rows.reduce((a, r) => ({ acc: a.acc + n(r.accrued), bank: a.bank + n(r.paid_bank), cash: a.cash + n(r.paid_cash), ded: a.ded + n(r.deductions), bal: a.bal + n(r.balance) }), { acc: 0, bank: 0, cash: 0, ded: 0, bal: 0 });
  const th = "py-3 px-3 font-semibold border-b border-line";
  const td = "py-2.5 px-3 border-b border-[#EEF2F6]";

  return (
    <>
      <PageHeader
        title={`${periodLabel(period)} maaş listesi`}
        subtitle="Personel 1 ayda ne hak etti, bankadan ve elden ne aldı, ne kaldı"
        actions={<Link href="/donemler" className="text-sm font-semibold text-brand-700">← Dönemler</Link>}
      />
      <div className="p-4 md:p-8 flex flex-col gap-5 max-w-[1240px]">
        <section className="grid gap-4 grid-cols-2 md:grid-cols-[repeat(auto-fit,minmax(200px,1fr))]">
          <Stat label="Hakediş" value={formatTL(t.acc)} sub={`${rows.length} personel`} />
          <Stat label="Bankadan ödenen" value={formatTL(t.bank)} />
          <Stat label="Elden ödenen" value={formatTL(t.cash)} />
          <Stat label="Kalan" value={formatTL(t.bal)} sub={`Kesintiler ${formatTL(t.ded)}`} />
        </section>
        <form className="flex gap-3">
          <select name="bolum" defaultValue={bolum ?? ""} aria-label="Bölüm" className="h-11 rounded-[10px] border border-[#D5DEE8] bg-white px-3">
            <option value="">Tüm bölümler</option>
            {depts.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
          <button className="h-11 px-4 rounded-[10px] bg-brand-700 text-white font-semibold">Filtrele</button>
        </form>
        <section className="bg-white border border-line rounded-[14px] overflow-x-auto">
          <table className="w-full text-sm min-w-[900px]">
            <thead>
              <tr className="text-left text-xs text-muted">
                <th className={th}>Bölüm</th><th className={th}>Personel</th><th className={th}>PDKS</th>
                <th className={`${th} text-right`}>Hakediş</th><th className={`${th} text-right`}>Banka</th><th className={`${th} text-right`}>Elden</th><th className={`${th} text-right`}>Kesinti</th><th className={`${th} text-right`}>Kalan</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.employee_id}>
                  <td className={td}>{r.dept}</td>
                  <td className={`${td} font-semibold`}><Link href={`/personel/${r.employee_id}?donem=${period}`} className="text-brand-700">{r.name}</Link></td>
                  <td className={`num ${td} text-muted`}>{r.cardNo}</td>
                  <td className={`num ${td} text-right`}>{formatTL(n(r.accrued))}</td>
                  <td className={`num ${td} text-right`}>{formatTL(n(r.paid_bank))}</td>
                  <td className={`num ${td} text-right`}>{formatTL(n(r.paid_cash))}</td>
                  <td className={`num ${td} text-right`}>{formatTL(n(r.deductions))}</td>
                  <td className={`num ${td} text-right font-semibold`}>{formatTL(n(r.balance))}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="font-semibold bg-[#F7F9FB]">
                <td className="py-3 px-3" colSpan={3}>Toplam</td>
                <td className="num py-3 px-3 text-right">{formatTL(t.acc)}</td><td className="num py-3 px-3 text-right">{formatTL(t.bank)}</td>
                <td className="num py-3 px-3 text-right">{formatTL(t.cash)}</td><td className="num py-3 px-3 text-right">{formatTL(t.ded)}</td><td className="num py-3 px-3 text-right">{formatTL(t.bal)}</td>
              </tr>
            </tfoot>
          </table>
        </section>
      </div>
    </>
  );
}
