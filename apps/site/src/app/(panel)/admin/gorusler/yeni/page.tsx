import { TestimonialForm } from "@/components/admin/TestimonialForm";
import { PageHead } from "@/components/admin/ui";

export const metadata = { title: "Yeni görüş" };

export default function NewTestimonial() {
  return (
    <>
      <PageHead title="Yeni hekim görüşü" />
      <TestimonialForm />
    </>
  );
}
