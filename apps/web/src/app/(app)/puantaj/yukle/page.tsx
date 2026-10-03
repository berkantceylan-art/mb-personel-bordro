import Link from "next/link";
import { PageHeader } from "@/components/ui";
import { getSession } from "@/lib/session";
import { ImportPunchForm } from "../PunchForms";

export default async function ImportPunchesPage() {
  await getSession();
  return (
    <>
      <PageHeader title="Cihaz dosyası yükle" actions={<Link href="/puantaj" className="text-sm font-semibold text-brand-700">← Puantaj</Link>} />
      <div className="p-6 md:p-8"><ImportPunchForm /></div>
    </>
  );
}
