import { notFound } from "next/navigation";
import { TestimonialForm } from "@/components/admin/TestimonialForm";
import { PageHead } from "@/components/admin/ui";
import type { Testimonial } from "@/lib/cms";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Görüşü düzenle" };

export default async function EditTestimonial({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const supabase = await createClient();
  const { data } = await supabase.from("cms_testimonials").select("*").eq("id", id).maybeSingle();
  if (!data) notFound();
  return (
    <>
      <PageHead title={(data as Testimonial).name} />
      <TestimonialForm item={data as Testimonial} />
    </>
  );
}
