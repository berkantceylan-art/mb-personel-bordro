import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { nextPeriod } from "@mb/core";
import { PageHeader } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { canManagePay, currentPeriod, getSession } from "@/lib/session";
import { EmployeeRaiseForm } from "./EmployeeRaiseForm";

export default async function EmployeeRaisePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await getSession();
  if (!canManagePay(s.role)) redirect(`/personel/${id}`);
  const supabase = await createClient();
  const [{ data: e }, { data: c }] = await Promise.all([
    supabase.from("employees").select("first_name, last_name").eq("id", id).maybeSingle(),
    supabase.from("pay_contracts").select("*").eq("employee_id", id).order("valid_from", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (!e) notFound();
  return (
    <>
      <PageHeader
        title={`${e.first_name} ${e.last_name} — zam / ücret değişikliği`}
        subtitle="Yeni ücret geçerlilik tarihinden itibaren uygulanır; ay ortasındaki değişiklik o ayın hakedişine günlere bölünerek yansır."
        actions={<Link href={`/personel/${id}`} className="text-sm font-semibold text-brand-700">← Profile dön</Link>}
      />
      <div className="p-4 md:p-8 max-w-4xl">
        <EmployeeRaiseForm
          employeeId={id}
          current={c ? Number(c.total_net) : null}
          insuranceType={c?.insurance_type ?? "MIN_WAGE"}
          fixedOfficialNet={c?.fixed_official_net ? (Number(c.fixed_official_net) / 100).toLocaleString("tr-TR") : ""}
          bes={Number(c?.bes_rate ?? 0) > 0}
          defaultDate={`${nextPeriod(currentPeriod())}-01`}
        />
      </div>
    </>
  );
}
