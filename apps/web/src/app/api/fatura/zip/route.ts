import JSZip from "jszip";
import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { invoiceXml } from "@/lib/invoice-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Toplu XML (ZIP): ?ids=a,b ya da ?durum=ready (gönderime hazır satış faturaları) */
export async function GET(req: NextRequest) {
  const s = await getSession();
  if ((s.modules.sales ?? 0) < 1) return new NextResponse("Yetkiniz yok", { status: 403 });
  let ids = (req.nextUrl.searchParams.get("ids") ?? "").split(",").filter((x) => /^[0-9a-f-]{36}$/i.test(x)).slice(0, 300);
  if (!ids.length && req.nextUrl.searchParams.get("durum") === "ready") {
    const supabase = await createClient();
    const { data } = await supabase.from("inv_invoices").select("id").eq("direction", "sale").eq("status", "posted").eq("einvoice_status", "ready").limit(300);
    ids = (data ?? []).map((r) => r.id as string);
  }
  if (!ids.length) return new NextResponse("Gönderime hazır fatura yok.", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  const zip = new JSZip();
  for (const id of ids) {
    const x = await invoiceXml(id);
    if (x) zip.file(x.name, x.xml);
  }
  const out = await zip.generateAsync({ type: "uint8array" });
  return new NextResponse(out as unknown as BodyInit, { headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="e-fatura-${new Date().toISOString().slice(0, 10)}.zip"` } });
}
