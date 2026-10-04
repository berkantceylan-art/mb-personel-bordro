import { ProductForm } from "@/components/admin/ProductForm";
import { PageHead } from "@/components/admin/ui";

export const metadata = { title: "Yeni ürün" };

export default function NewProduct() {
  return (
    <>
      <PageHead title="Yeni ürün" lead="Türkçe ad zorunlu; İngilizce ve Fransızca boşsa sitede Türkçesi görünür." />
      <ProductForm />
    </>
  );
}
