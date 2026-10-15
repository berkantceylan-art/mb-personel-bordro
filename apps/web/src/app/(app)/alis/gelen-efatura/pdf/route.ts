import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

/** Gelen kutusundaki PDF fatura (e-Arşiv) */
export async function GET(req: Request) {
  const s = await getSession();
  if ((s.modules.purchases ?? 0) < 1 && (s.modules.ledger ?? 0) < 1) return NextResponse.json({ error: "yetkisiz" }, { status: 403 });
  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!/^[0-9a-f-]{36}$/.test(id)) return NextResponse.json({ error: "id" }, { status: 400 });
  const supabase = await createClient();
  const { data } = await supabase.from("einv_inbox").select("pdf_path, doc_no").eq("id", id).maybeSingle();
  if (!data?.pdf_path) return NextResponse.json({ error: "bulunamadı" }, { status: 404 });
  const { data: blob, error } = await createAdminClient().storage.from("documents").download(data.pdf_path as string);
  if (error || !blob) return NextResponse.json({ error: "dosya okunamadı" }, { status: 404 });
  return new NextResponse(new Uint8Array(await blob.arrayBuffer()), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${(data.doc_no as string) || id}.pdf"` } });
}
