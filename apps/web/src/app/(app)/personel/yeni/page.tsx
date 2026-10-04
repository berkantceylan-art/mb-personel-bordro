import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import { EmployeeForm } from "../EmployeeForm";

export default async function NewEmployeePage() {
  const s = await getSession();
  if (!["owner", "accountant", "hr"].includes(s.role)) redirect("/personel");
  const supabase = await createClient();
  const [{ data: branches }, { data: departments }] = await Promise.all([
    supabase.from("branches").select("id, name").order("name"),
    supabase.from("departments").select("id, name").order("name"),
  ]);
  return (
    <>
      <PageHeader title="Yeni personel" />
      <div className="p-4 md:p-8 max-w-5xl">
        <EmployeeForm values={{ nationality: "T.C.", bank_name: "Garanti BBVA" }} branches={branches ?? []} departments={departments ?? []} isNew />
      </div>
    </>
  );
}
