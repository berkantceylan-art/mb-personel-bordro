import { SlideForm } from "@/components/admin/SlideForm";
import { PageHead } from "@/components/admin/ui";

export const metadata = { title: "Yeni slayt" };

export default function NewSlide() {
  return (
    <>
      <PageHead title="Yeni slayt" lead="Türkçe başlık zorunlu; İngilizce ve Fransızca boşsa sitede Türkçesi görünür." />
      <SlideForm />
    </>
  );
}
