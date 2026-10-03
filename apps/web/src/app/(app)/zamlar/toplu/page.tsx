import Link from "next/link";
import { redirect } from "next/navigation";
import { nextPeriod } from "@mb/core";
import { PageHeader } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { canManagePay, currentPeriod, getSession } from "@/lib/session";
import { currentContracts } from "../actions";
import { BulkRaiseForm, type RaiseEmployee } from "../BulkRaiseForm";

export default async function BulkRaisePage() {
  const s = await getSession();
  if (!canManagePay(s.role)) redirect("/");
  const supabase = await createClient();
  const { data: emps } = await supabase.from("employees").select("id, first_name, last_name, departments(name)").eq("status", "active").order("first_name");
  const defaultDate = `${nextPeriod(currentPeriod())}-01`;
  const current = await currentContracts((emps ?? []).map((e) => e.id), "9999-12-31");
  const employees: RaiseEmployee[] = (emps ?? []).map((e) => ({
    id: e.id,
    name: `${e.first_name} ${e.last_name}`,
    dept: (e.departments as unknown as { name: string } | null)?.name ?? "Bölümsüz",
    current: current.get(e.id)?.total_net ?? null,
  }));
  const departments = [...new Set(employees.map((e) => e.dept))].sort((a, b) => a.localeCompare(b, "tr"));
  return (
    <>
      <PageHeader
        title="Toplu zam"
        subtitle="Bölüm veya tüm personel için; uygulamadan önce kişi kişi önizleyin, istemediklerinizi çıkarın."
        actions={<Link href="/zamlar" className="text-sm font-semibold text-brand-700">← Zam raporu</Link>}
      />
      <div className="p-6 md:p-8 max-w-[1240px]">
        <BulkRaiseForm employees={employees} departments={departments} defaultDate={defaultDate} />
      </div>
    </>
  );
}
