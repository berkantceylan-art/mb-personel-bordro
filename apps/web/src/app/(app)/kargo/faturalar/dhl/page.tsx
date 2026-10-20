import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { CarrierView, type CarrierSp } from "../CarrierView";

export const dynamic = "force-dynamic";
export const metadata = { title: "DHL faturaları" };

export default async function Page({ searchParams }: { searchParams: Promise<CarrierSp> }) {
  const s = await getSession();
  if (!s.logistics && (s.modules.finance ?? 0) < 1) redirect("/");
  return <CarrierView carrier="dhl" sp={await searchParams} />;
}
