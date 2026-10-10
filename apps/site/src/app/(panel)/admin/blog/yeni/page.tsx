import { PostForm } from "@/components/admin/PostForm";
import { PageHead } from "@/components/admin/ui";

export const metadata = { title: "Yeni yazı" };

export default function NewPost() {
  return (
    <>
      <PageHead title="Yeni yazı" lead="Önce Türkçesini yazın; çevirileri yapay zekâ düğmesiyle hazırlayıp kontrol edebilirsiniz." />
      <PostForm />
    </>
  );
}
