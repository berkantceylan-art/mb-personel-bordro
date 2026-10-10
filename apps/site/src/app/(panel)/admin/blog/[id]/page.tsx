import { notFound } from "next/navigation";
import { PostForm } from "@/components/admin/PostForm";
import { PageHead } from "@/components/admin/ui";
import type { Post } from "@/lib/cms";
import { t } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Yazıyı düzenle" };

export default async function EditPost({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const supabase = await createClient();
  const { data } = await supabase.from("cms_posts").select("*").eq("id", id).maybeSingle();
  if (!data) notFound();
  const post = data as Post;
  return (
    <>
      <PageHead title={t(post.title, "tr") || "Yazıyı düzenle"} />
      <PostForm post={post} />
    </>
  );
}
