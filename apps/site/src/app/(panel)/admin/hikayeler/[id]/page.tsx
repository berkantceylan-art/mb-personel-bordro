import { notFound } from "next/navigation";
import { StoryForm } from "@/components/admin/StoryForm";
import { PageHead, StateBadge } from "@/components/admin/ui";
import type { Story } from "@/lib/cms";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Hikâyeyi düzenle" };

export default async function EditStory({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const supabase = await createClient();
  const { data } = await supabase.from("cms_stories").select("*").eq("id", id).maybeSingle();
  if (!data) notFound();
  const story = data as Story;
  return (
    <>
      <PageHead title="Hikâyeyi düzenle" />
      <div className="-mt-5 mb-6">
        <StateBadge row={story} />
      </div>
      <StoryForm story={story} />
    </>
  );
}
