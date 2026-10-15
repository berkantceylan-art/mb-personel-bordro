import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { elogoDocFile, withElogo } from "@/lib/elogo";
import { docTypeOf } from "@/lib/einv-send";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** eLogo'ya gönderilmiş faturanın resmî görüntüsü (PDF; ?bicim=html) */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!s.userId) return new NextResponse("Giriş yapın", { status: 401 });
  const { id } = await params;
  const supabase = await createClient();
  const { data: inv } = await supabase.from("inv_invoices").select("ettn, doc_no, profile, einvoice_status").eq("id", id).maybeSingle();
  if (!inv) return new NextResponse("Fatura bulunamadı ya da yetkiniz yok", { status: 404 });
  if (!["sent", "accepted", "rejected", "cancelled", "draft_sent"].includes(inv.einvoice_status as string)) return new NextResponse("Fatura henüz eLogo'ya gönderilmedi.", { status: 400, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  const html = new URL(req.url).searchParams.get("bicim") === "html";
  try {
    const f = await withElogo((w, ss) => elogoDocFile(w, ss, inv.ettn as string, docTypeOf(inv.profile as string), html ? "HTML" : "PDF"));
    if (!f) return new NextResponse("eLogo belgeyi vermedi (taslaktaysa önce portalda onaylayın).", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
    const name = `${inv.doc_no ?? inv.ettn}.${html ? "html" : "pdf"}`;
    return new NextResponse(new Uint8Array(f.data), { headers: { "Content-Type": html ? "text/html; charset=utf-8" : "application/pdf", "Content-Disposition": `${html ? "inline" : "attachment"}; filename="${name}"` } });
  } catch (e) {
    return new NextResponse(`eLogo: ${(e as Error).message}`, { status: 502, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
}
