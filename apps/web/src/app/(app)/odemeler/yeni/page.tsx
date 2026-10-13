import Link from "next/link";
import { redirect } from "next/navigation";
import { previousPeriod } from "@mb/core";
import { PageHeader } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { canManagePay, currentPeriod, getSession, periodLabel, todayIso } from "@/lib/session";
import { PaymentForm, type EmployeeOption } from "./PaymentForm";

export default async function NewPaymentPage({ searchParams }: { searchParams: Promise<{ personel?: string }> }) {
  const s = await getSession();
  if (!canManagePay(s.role)) redirect("/");
  const { personel } = await searchParams;
  const supabase = await createClient();
  const period = currentPeriod();

  const [{ data: emps }, { data: balances }, { data: monthPays }, { data: recent }, { data: accRows }] = await Promise.all([
    supabase.from("employees").select("id, first_name, last_name, card_no, departments(name)").eq("status", "active").order("first_name"),
    supabase.from("ledger_period_summary").select("employee_id, balance, accrued").eq("period", period),
    supabase.from("ledger_entries").select("employee_id, type, amount, entry_date").eq("period", period).in("type", ["ADVANCE", "SALARY"]).is("voided_at", null),
    supabase.from("ledger_entries").select("employee_id, created_at").in("type", ["ADVANCE", "SALARY", "BONUS", "DEDUCTION"]).is("voided_at", null).order("created_at", { ascending: false }).limit(60),
    supabase.from("fin_accounts").select("id, name, kind").in("kind", ["bank", "cash"]).eq("is_active", true).eq("currency", "TRY").order("sort").order("name"),
  ]);
  const bal = new Map((balances ?? []).map((b) => [b.employee_id as string, { balance: Number(b.balance ?? 0), accrued: Number(b.accrued ?? 0) }]));
  const adv = new Map<string, { total: number; count: number; last: string | null }>();
  for (const p of monthPays ?? []) {
    if (p.type !== "ADVANCE") continue;
    const cur = adv.get(p.employee_id) ?? { total: 0, count: 0, last: null };
    cur.total += Number(p.amount);
    cur.count++;
    if (!cur.last || p.entry_date > cur.last) cur.last = p.entry_date;
    adv.set(p.employee_id, cur);
  }
  const recentIds = [...new Set((recent ?? []).map((r) => r.employee_id as string))].slice(0, 8);
  const employees: EmployeeOption[] = (emps ?? []).map((e) => ({
    id: e.id,
    name: `${e.first_name} ${e.last_name}`,
    dept: (e.departments as unknown as { name: string } | null)?.name ?? "—",
    cardNo: e.card_no,
    balance: bal.has(e.id) ? bal.get(e.id)!.balance : null,
    accrued: bal.get(e.id)?.accrued ?? 0,
    advTotal: adv.get(e.id)?.total ?? 0,
    advCount: adv.get(e.id)?.count ?? 0,
    lastAdv: adv.get(e.id)?.last ?? null,
  }));
  const departments = [...new Set(employees.map((e) => e.dept))].sort((a, b) => a.localeCompare(b, "tr"));
  const periods = [period, previousPeriod(period)].map((p) => ({ value: p, label: periodLabel(p) }));
  const accounts = (accRows ?? []).map((a) => ({ id: a.id, name: a.name, kind: a.kind as "bank" | "cash" }));

  return (
    <>
      <PageHeader
        title="Avans / Ödeme Girişi"
        subtitle={`${periodLabel(period)} · personeli arayın ya da dokunun, tutarı yazın, kasa / bankayı seçin`}
        actions={
          <div className="flex gap-2 flex-wrap">
            <Link href="/maas-plani" className="h-11 px-4 inline-flex items-center rounded-[10px] border border-[#D5DEE8] bg-white text-brand-700 font-semibold">Maaş planı</Link>
            <Link href="/raporlar/avans-listesi" className="h-11 px-4 inline-flex items-center rounded-[10px] border border-[#D5DEE8] bg-white text-brand-700 font-semibold">Kayıtlı avanslar / yazdır</Link>
          </div>
        }
      />
      <div className="p-4 md:p-6">
        <PaymentForm employees={employees} departments={departments} recentIds={recentIds} defaultSelected={personel ? [personel] : []} today={todayIso()} periods={periods} accounts={accounts} />
      </div>
    </>
  );
}
