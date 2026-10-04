import { StoryForm } from "@/components/admin/StoryForm";
import { PageHead } from "@/components/admin/ui";

export const metadata = { title: "Yeni hikâye" };

export default function NewStory() {
  return (
    <>
      <PageHead title="Yeni hikâye" lead="Türkçe başlık ve en az bir kare zorunlu." />
      <StoryForm />
    </>
  );
}
