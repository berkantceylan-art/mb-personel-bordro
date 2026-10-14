import { createClient } from "@/lib/supabase/server";
import { t } from "@/lib/i18n";

/** Soru formu için ürün ve bölge listeleri */
export async function faqScopes() {
  const supabase = await createClient();
  const [{ data: pr }, { data: ar }] = await Promise.all([
    supabase.from("cms_products").select("slug, name").is("deleted_at", null).order("sort"),
    supabase.from("cms_areas").select("slug, name").is("deleted_at", null).order("sort"),
  ]);
  return {
    products: ((pr ?? []) as Array<{ slug: string; name: Record<string, string> }>).map((p) => ({ slug: p.slug, name: t(p.name, "tr") })),
    areas: ((ar ?? []) as Array<{ slug: string; name: Record<string, string> }>).map((a) => ({ slug: a.slug, name: t(a.name, "tr") })),
  };
}
