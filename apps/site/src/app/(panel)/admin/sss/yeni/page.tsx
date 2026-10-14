import { FaqForm } from "@/components/admin/FaqForm";
import { PageHead } from "@/components/admin/ui";
import { faqScopes } from "@/lib/faq-scopes";

export const metadata = { title: "Yeni soru" };

export default async function NewFaqPage() {
  const sc = await faqScopes();
  return (
    <>
      <PageHead title="Yeni soru" lead="Türkçe soru ve cevap zorunlu; diğer diller boşsa sitede Türkçesi görünür." />
      <FaqForm {...sc} />
    </>
  );
}
