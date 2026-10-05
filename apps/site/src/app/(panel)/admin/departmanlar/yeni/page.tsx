import { DepartmentForm } from "@/components/admin/TeamForms";
import { PageHead } from "@/components/admin/ui";

export const metadata = { title: "Yeni departman" };

export default function NewDepartmentPage() {
  return (
    <>
      <PageHead title="Yeni departman" />
      <DepartmentForm />
    </>
  );
}
