import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, PageHeader } from "@/components/ui";
import { getSession } from "@/lib/session";
import { ShipmentForm } from "../ShipmentForm";
import { formOptions } from "../data";

export default async function NewShipmentPage({ searchParams }: { searchParams: Promise<{ yon?: string }> }) {
  const s = await getSession();
  if (!s.logistics) redirect("/");
  const direction = (await searchParams).yon === "out" ? "out" : "in";
  const { accounts, cases } = await formOptions();
  return (
    <>
      <PageHeader title={direction === "in" ? "Gelen paket" : "Giden gönderi"} subtitle={direction === "in" ? "DHL, UPS, gümrük ya da kuryeyle gelen ölçü / model" : "Biten işin kurye ya da kargoyla gönderimi"} actions={<Link href="/kargo" className="text-sm font-semibold text-brand-700">Listeye dön</Link>} />
      <div className="p-4 md:p-8 max-w-[1000px]">
        <Card>
          <ShipmentForm direction={direction} accounts={accounts} cases={cases} />
        </Card>
      </div>
    </>
  );
}
