import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

/** Gelen e-faturanın XML'i (indir) */
export async function GET(req: Request) {
  const s = await getSession();
  if ((s.modules.purchases ?? 0) < 1 && (s.modules.ledger ?? 0) < 1) return NextResponse.json({ error: "yetkisiz" }, { status: 403 });
  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!/^[0-9a-f-]{36}$/.test(id)) return NextResponse.json({ error: "id" }, { status: 400 });
  const supabase = await createClient();
  const { data } = await supabase.from("einv_inbox").select("xml, doc_no").eq("id", id).maybeSingle();
  if (!data) return NextResponse.json({ error: "bulunamadı" }, { status: 404 });
  return new NextResponse(data.xml as string, { headers: { "Content-Type": "application/xml; charset=utf-8", "Content-Disposition": `attachment; filename="${(data.doc_no as string) || id}.xml"` } });
}
