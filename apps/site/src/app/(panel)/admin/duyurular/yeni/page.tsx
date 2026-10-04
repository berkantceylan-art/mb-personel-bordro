import { AnnouncementForm } from "@/components/admin/AnnouncementForm";
import { PageHead } from "@/components/admin/ui";

export const metadata = { title: "Yeni duyuru" };

export default function NewAnnouncement() {
  return (
    <>
      <PageHead title="Yeni duyuru" lead="Türkçe başlık zorunlu; İngilizce ve Fransızca boşsa sitede Türkçesi görünür." />
      <AnnouncementForm />
    </>
  );
}
