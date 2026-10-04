import { notFound } from "next/navigation";
import { SlideForm } from "@/components/admin/SlideForm";
import { PageHead, StateBadge } from "@/components/admin/ui";
import type { Slide } from "@/lib/cms";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Slaytı düzenle" };

export default async function EditSlide({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data } = await supabase.from("cms_slides").select("*").eq("id", id).maybeSingle();
  if (!data) notFound();
  const slide = data as Slide;
  return (
    <>
      <PageHead title="Slaytı düzenle" />
      <div className="-mt-5 mb-6">
        <StateBadge row={slide} />
      </div>
      <SlideForm slide={slide} />
    </>
  );
}
