import { notFound } from "next/navigation";
import { PageForm } from "@/components/admin/PageForm";
import { PageHead } from "@/components/admin/ui";
import type { SitePage } from "@/lib/cms";
import { t } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Sayfayı düzenle" };

export default async function EditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const supabase = await createClient();
  const { data } = await supabase.from("cms_pages").select("*").eq("id", id).maybeSingle();
  if (!data) notFound();
  const page = data as SitePage;
  return (
    <>
      <PageHead title={t(page.title, "tr") || "Sayfayı düzenle"} lead={page.deleted_at ? "Bu sayfa çöp kutusunda. Düzenlemek için önce geri alın." : undefined} />
      <PageForm page={page} />
    </>
  );
}
