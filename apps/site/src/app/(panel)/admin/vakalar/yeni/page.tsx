import { CaseForm } from "@/components/admin/CaseForm";
import { PageHead } from "@/components/admin/ui";
import { t } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Yeni vaka" };

export default async function NewCase() {
  const supabase = await createClient();
  const { data } = await supabase.from("cms_products").select("slug, name").is("deleted_at", null).order("sort");
  const products = ((data ?? []) as { slug: string; name: Record<string, string> }[]).map((p) => ({ slug: p.slug, name: t(p.name, "tr") }));
  return (
    <>
      <PageHead title="Yeni vaka" lead="Türkçe başlık ve en az bir görsel zorunlu." />
      <CaseForm products={products} />
    </>
  );
}
