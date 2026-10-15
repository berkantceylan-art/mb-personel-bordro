import { NewInvoice } from "../../fatura/_parts/NewInvoice";
import { getSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { initialFromRead, readPurchaseInvoice, type Out } from "@/lib/invoice-ocr";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export default async function Page({ searchParams }: { searchParams: Promise<{ cari?: string; iade?: string; kaynak?: string; foto?: string; gelen?: string }> }) {
  const sp = await searchParams;
  if (sp.foto) {
    const s = await getSession();
    const r = (s.modules.purchases ?? 0) >= 2 ? await readPurchaseInvoice(sp.foto, s.userId) : { ok: false, note: "Alış yetkiniz yok." };
    return <NewInvoice direction="purchase" initial={r.initial ?? { type: "invoice" }} ocrNote={{ ok: r.ok, note: r.note }} />;
  }
  // Gelen kutusundaki PDF'ten okunmuş e-Arşiv fatura → alış faturası formu (ETTN ile bağlanır)
  if (sp.gelen && /^[0-9a-f-]{36}$/i.test(sp.gelen)) {
    const supabase = await createClient();
    const { data: e } = await supabase.from("einv_inbox").select("ettn, ai_data, doc_no").eq("id", sp.gelen).maybeSingle();
    if (e?.ai_data) {
      const r = await initialFromRead(supabase, e.ai_data as Out, `${e.doc_no ?? ""} e-Arşiv faturası (PDF'ten yapay zekâ ile okundu — kontrol edin)`.trim(), { ettn: e.ettn as string });
      return <NewInvoice direction="purchase" initial={r.initial} ocrNote={{ ok: r.ok, note: `${r.note} Kaydedince fatura gelen kutusunda “aktarıldı” görünür.` }} />;
    }
  }
  return <NewInvoice direction="purchase" fromId={sp.kaynak} asReturn={sp.iade === "1"} initial={{ party_id: sp.cari, type: sp.iade === "1" ? "return" : "invoice" }} />;
}
