import { notFound } from "next/navigation";
import { AnnouncementForm } from "@/components/admin/AnnouncementForm";
import { PageHead, StateBadge } from "@/components/admin/ui";
import type { Announcement } from "@/lib/cms";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Duyuruyu düzenle" };

export default async function EditAnnouncement({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data } = await supabase.from("cms_announcements").select("*").eq("id", id).maybeSingle();
  if (!data) notFound();
  const item = data as Announcement;
  return (
    <>
      <PageHead title="Duyuruyu düzenle" />
      <div className="-mt-5 mb-6">
        <StateBadge row={item} />
      </div>
      <AnnouncementForm item={item} />
    </>
  );
}
