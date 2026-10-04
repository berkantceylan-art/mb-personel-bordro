import { notFound } from "next/navigation";
import { CaseForm } from "@/components/admin/CaseForm";
import { PageHead } from "@/components/admin/ui";
import type { CaseItem } from "@/lib/cms";
import { t } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Vakayı düzenle" };

export default async function EditCase({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const supabase = await createClient();
  const [{ data }, { data: prods }] = await Promise.all([
    supabase.from("cms_cases").select("*").eq("id", id).maybeSingle(),
    supabase.from("cms_products").select("slug, name").is("deleted_at", null).order("sort"),
  ]);
  if (!data) notFound();
  const item = data as CaseItem;
  const products = ((prods ?? []) as { slug: string; name: Record<string, string> }[]).map((p) => ({ slug: p.slug, name: t(p.name, "tr") }));
  return (
    <>
      <PageHead title={t(item.title, "tr") || "Vakayı düzenle"} />
      <CaseForm item={item} products={products} />
    </>
  );
}
