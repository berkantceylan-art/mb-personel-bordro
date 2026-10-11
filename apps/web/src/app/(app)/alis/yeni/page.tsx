import { NewInvoice } from "../../fatura/_parts/NewInvoice";

export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<{ cari?: string; iade?: string; kaynak?: string }> }) {
  const sp = await searchParams;
  return <NewInvoice direction="purchase" fromId={sp.kaynak} asReturn={sp.iade === "1"} initial={{ party_id: sp.cari, type: sp.iade === "1" ? "return" : "invoice" }} />;
}
