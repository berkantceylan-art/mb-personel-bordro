import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { canManagePay, currentPeriod, getSession, periodLabel, todayIso } from "@/lib/session";
import { PaymentForm, type EmployeeOption } from "./PaymentForm";

function prevPeriod(p: string) {
  const [y, m] = p.split("-").map(Number) as [number, number];
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

export default async function NewPaymentPage({ searchParams }: { searchParams: Promise<{ personel?: string }> }) {
  const s = await getSession();
  if (!canManagePay(s.role)) redirect("/");
  const { personel } = await searchParams;
  const supabase = await createClient();
  const period = currentPeriod();

  const [{ data: emps }, { data: balances }] = await Promise.all([
    supabase.from("employees").select("id, first_name, last_name, card_no, departments(name)").eq("status", "active").order("first_name"),
    supabase.from("ledger_period_summary").select("employee_id, balance").eq("period", period),
  ]);
  const bal = new Map((balances ?? []).map((b) => [b.employee_id as string, Number(b.balance ?? 0)]));
  const employees: EmployeeOption[] = (emps ?? []).map((e) => ({
    id: e.id,
    name: `${e.first_name} ${e.last_name}`,
    dept: (e.departments as unknown as { name: string } | null)?.name ?? "—",
    cardNo: e.card_no,
    balance: bal.has(e.id) ? bal.get(e.id)! : null,
  }));
  const departments = [...new Set(employees.map((e) => e.dept))].sort((a, b) => a.localeCompare(b, "tr"));
  const periods = [period, prevPeriod(period)].map((p) => ({ value: p, label: periodLabel(p) }));

  return (
    <>
      <PageHeader
        title="Avans / Ödeme Girişi"
        subtitle="Elden ödemelerde imza alınır; tüm hareketler tarihli tutulur."
        actions={<Link href="/raporlar/avans-listesi" className="h-11 px-4 inline-flex items-center rounded-[10px] border border-[#D5DEE8] bg-white text-brand-700 font-semibold">Kayıtlı avanslar / yazdır</Link>}
      />
      <div className="p-4 md:p-6">
        <PaymentForm employees={employees} departments={departments} defaultSelected={personel ? [personel] : []} today={todayIso()} periods={periods} />
      </div>
    </>
  );
}
