import { TeamMemberForm } from "@/components/admin/TeamForms";
import { PageHead } from "@/components/admin/ui";
import type { Department } from "@/lib/cms";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Yeni çalışan" };

export default async function NewMemberPage() {
  const supabase = await createClient();
  const { data } = await supabase.from("cms_departments").select("*").is("deleted_at", null).order("sort");
  return (
    <>
      <PageHead title="Yeni çalışan" />
      <TeamMemberForm departments={(data ?? []) as Department[]} />
    </>
  );
}
