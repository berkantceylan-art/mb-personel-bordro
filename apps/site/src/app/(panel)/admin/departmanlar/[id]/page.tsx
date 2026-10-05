import { notFound } from "next/navigation";
import { DepartmentForm } from "@/components/admin/TeamForms";
import { PageHead } from "@/components/admin/ui";
import type { Department } from "@/lib/cms";
import { t } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Departmanı düzenle" };

export default async function EditDepartmentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const supabase = await createClient();
  const { data } = await supabase.from("cms_departments").select("*").eq("id", id).maybeSingle();
  if (!data) notFound();
  const dep = data as Department;
  return (
    <>
      <PageHead title={t(dep.name, "tr") || "Departmanı düzenle"} lead={dep.deleted_at ? "Bu departman çöp kutusunda. Düzenlemek için önce geri alın." : undefined} />
      <DepartmentForm dep={dep} />
    </>
  );
}
