import { notFound } from "next/navigation";
import { TeamMemberForm } from "@/components/admin/TeamForms";
import { PageHead } from "@/components/admin/ui";
import type { Department, TeamMember } from "@/lib/cms";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Çalışanı düzenle" };

export default async function EditMemberPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const supabase = await createClient();
  const [{ data }, { data: deps }] = await Promise.all([
    supabase.from("cms_team").select("*").eq("id", id).maybeSingle(),
    supabase.from("cms_departments").select("*").is("deleted_at", null).order("sort"),
  ]);
  if (!data) notFound();
  const m = data as TeamMember;
  return (
    <>
      <PageHead title={m.name} lead={m.deleted_at ? "Bu kayıt çöp kutusunda. Düzenlemek için önce geri alın." : undefined} />
      <TeamMemberForm member={m} departments={(deps ?? []) as Department[]} />
    </>
  );
}
