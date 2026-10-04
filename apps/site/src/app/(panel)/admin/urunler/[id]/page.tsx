import { notFound } from "next/navigation";
import { ProductForm } from "@/components/admin/ProductForm";
import { PageHead } from "@/components/admin/ui";
import type { Product } from "@/lib/cms";
import { t } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Ürünü düzenle" };

export default async function EditProduct({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const supabase = await createClient();
  const { data } = await supabase.from("cms_products").select("*").eq("id", id).maybeSingle();
  if (!data) notFound();
  const product = data as Product;
  return (
    <>
      <PageHead title={t(product.name, "tr") || "Ürünü düzenle"} lead={product.deleted_at ? "Bu ürün çöp kutusunda. Düzenlemek için önce geri alın." : undefined} />
      <ProductForm product={product} />
    </>
  );
}
