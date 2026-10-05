import { FaqForm } from "@/components/admin/FaqForm";
import { PageHead } from "@/components/admin/ui";

export const metadata = { title: "Yeni soru" };

export default function NewFaqPage() {
  return (
    <>
      <PageHead title="Yeni soru" lead="Türkçe soru ve cevap zorunlu; diğer diller boşsa sitede Türkçesi görünür." />
      <FaqForm />
    </>
  );
}
