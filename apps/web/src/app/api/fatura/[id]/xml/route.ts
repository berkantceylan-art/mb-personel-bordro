import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { invoiceXml } from "@/lib/invoice-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Faturanın e-Fatura (UBL-TR) XML'i: entegratör portalına yüklenir */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!s.userId) return new NextResponse("Giriş yapın", { status: 401 });
  const { id } = await params;
  const out = await invoiceXml(id);
  if (!out) return new NextResponse("Fatura bulunamadı ya da yetkiniz yok", { status: 404 });
  return new NextResponse(out.xml, { headers: { "Content-Type": "application/xml; charset=utf-8", "Content-Disposition": `attachment; filename="${out.name}"` } });
}
