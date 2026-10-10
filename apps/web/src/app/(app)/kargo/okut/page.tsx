import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { getSession } from "@/lib/session";
import { Scanner } from "./Scanner";

export default async function ScanPage() {
  const s = await getSession();
  if (!s.logistics) redirect("/");
  return (
    <>
      <PageHeader title="Paket okut" subtitle="Gelen paketin barkodunu telefonla okutun: kayıt bulunur, tek dokunuşla teslim alınır" actions={<Link href="/kargo" className="text-sm font-semibold text-brand-700">Kargo listesi</Link>} />
      <div className="p-4 md:p-8 max-w-[640px]">
        <Scanner />
      </div>
    </>
  );
}
