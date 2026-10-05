import { notFound } from "next/navigation";
import { FaqForm } from "@/components/admin/FaqForm";
import { PageHead } from "@/components/admin/ui";
import type { Faq } from "@/lib/cms";
import { t } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Soruyu düzenle" };

export default async function EditFaqPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const supabase = await createClient();
  const { data } = await supabase.from("cms_faqs").select("*").eq("id", id).maybeSingle();
  if (!data) notFound();
  const faq = data as Faq;
  return (
    <>
      <PageHead title={t(faq.question, "tr") || "Soruyu düzenle"} lead={faq.deleted_at ? "Bu soru çöp kutusunda. Düzenlemek için önce geri alın." : undefined} />
      <FaqForm faq={faq} />
    </>
  );
}
