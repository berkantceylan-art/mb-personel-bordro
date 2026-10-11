import { NewInvoice } from "../../fatura/_parts/NewInvoice";
import { getSession } from "@/lib/session";
import { readPurchaseInvoice } from "@/lib/invoice-ocr";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export default async function Page({ searchParams }: { searchParams: Promise<{ cari?: string; iade?: string; kaynak?: string; foto?: string }> }) {
  const sp = await searchParams;
  if (sp.foto) {
    const s = await getSession();
    const r = (s.modules.purchases ?? 0) >= 2 ? await readPurchaseInvoice(sp.foto, s.userId) : { ok: false, note: "Alış yetkiniz yok." };
    return <NewInvoice direction="purchase" initial={r.initial ?? { type: "invoice" }} ocrNote={{ ok: r.ok, note: r.note }} />;
  }
  return <NewInvoice direction="purchase" fromId={sp.kaynak} asReturn={sp.iade === "1"} initial={{ party_id: sp.cari, type: sp.iade === "1" ? "return" : "invoice" }} />;
}
