import Link from "next/link";
import { formatTL } from "@mb/core";
import { PageHeader, PrimaryLink } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { canManagePay, currentPeriod, formatDate, getSession } from "@/lib/session";
import { EmployeeList } from "./EmployeeList";

export default async function EmployeesPage({
  searchParams,
}: {
  searchParams: Promise<{ bolum?: string; q?: string; durum?: string }>;
}) {
  const { bolum, q, durum } = await searchParams;
  const s = await getSession();
  const supabase = await createClient();
  const period = currentPeriod();
  const pay = canManagePay(s.role);

  const [{ data: employees }, { data: departments }, { data: balances }] = await Promise.all([
    supabase
      .from("employees")
      .select("id, card_no, first_name, last_name, hire_date, status, department_id, departments(name), branches(name)")
      .order("first_name"),
    supabase.from("departments").select("id, name").order("name"),
    pay
      ? supabase.from("ledger_period_summary").select("employee_id, balance").eq("period", period)
      : Promise.resolve({ data: [] as Array<{ employee_id: string; balance: number }> }),
  ]);
  const bal = new Map((balances ?? []).map((b) => [b.employee_id, Number(b.balance ?? 0)]));
  const rows = (employees ?? []).map((e) => ({
    id: e.id,
    name: `${e.first_name} ${e.last_name === "-" ? "" : e.last_name}`.trim(),
    card: e.card_no,
    dept: (e.departments as unknown as { name: string } | null)?.name ?? null,
    deptId: e.department_id,
    branch: (e.branches as unknown as { name: string } | null)?.name ?? null,
    hire: formatDate(e.hire_date),
    status: e.status,
    balance: bal.has(e.id) ? formatTL(bal.get(e.id)!) : null,
  }));
  const active = rows.filter((r) => r.status !== "terminated").length;

  return (
    <>
      <PageHeader
        title="Personel"
        subtitle={`${active} aktif çalışan · ${rows.length - active} ayrılan`}
        actions={
          <div className="flex gap-2 flex-wrap">
            <Link href="/ice-aktar" className="h-11 px-4 inline-flex items-center rounded-[10px] border border-[#D5DEE8] bg-white text-brand-700 font-semibold">Excel&apos;den aktar</Link>
            <PrimaryLink href="/personel/yeni">+ Yeni personel</PrimaryLink>
          </div>
        }
      />
      <div className="p-4 md:p-8 flex flex-col gap-4 max-w-[1240px]">
        <EmployeeList
          rows={rows}
          departments={departments ?? []}
          showBalance={pay}
          initial={{ q: q ?? "", bolum: bolum ?? "", durum: durum === "ayrilan" || durum === "tumu" ? durum : "aktif" }}
        />
      </div>
    </>
  );
}
