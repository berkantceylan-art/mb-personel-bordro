import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { elogoDocFile, withElogo } from "@/lib/elogo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** eLogo'ya gönderilmiş e-İrsaliyenin resmî görüntüsü (PDF; ?bicim=html) */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!s.userId) return new NextResponse("Giriş yapın", { status: 401 });
  const { id } = await params;
  const supabase = await createClient();
  const { data: d } = await supabase.from("edsp_despatches").select("ettn, doc_no, einv_status").eq("id", id).maybeSingle();
  if (!d) return new NextResponse("İrsaliye bulunamadı ya da yetkiniz yok", { status: 404 });
  const html = new URL(req.url).searchParams.get("bicim") === "html";
  try {
    const f = await withElogo((w, ss) => elogoDocFile(w, ss, d.ettn as string, "DESPATCHADVICE", html ? "HTML" : "PDF"));
    if (!f) return new NextResponse("eLogo belgeyi vermedi (taslaktaysa önce portalda onaylayın).", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
    return new NextResponse(new Uint8Array(f.data), { headers: { "Content-Type": html ? "text/html; charset=utf-8" : "application/pdf", "Content-Disposition": `${html ? "inline" : "attachment"}; filename="${d.doc_no ?? d.ettn}.${html ? "html" : "pdf"}"` } });
  } catch (e) {
    return new NextResponse(`eLogo: ${(e as Error).message}`, { status: 502, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
}
