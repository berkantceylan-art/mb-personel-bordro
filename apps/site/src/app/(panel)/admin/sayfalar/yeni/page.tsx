import { PageForm } from "@/components/admin/PageForm";
import { PageHead } from "@/components/admin/ui";

export const metadata = { title: "Yeni sayfa" };

export default function NewPage() {
  return (
    <>
      <PageHead title="Yeni sayfa" lead="Türkçe başlık zorunlu; İngilizce ve Fransızca boşsa sitede Türkçesi görünür." />
      <PageForm />
    </>
  );
}
