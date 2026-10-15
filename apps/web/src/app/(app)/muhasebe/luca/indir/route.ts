import JSZip from "jszip";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import { lucaBatchFiles, type LucaBatchData } from "@/lib/luca-files";

export const dynamic = "force-dynamic";

/** Luca aktarım paketi: fiş tipine göre ayrı, 50 fişlik dosyalar (tek dosyaysa doğrudan, çoksa ZIP) */
export async function GET(req: Request) {
  const s = await getSession();
  if ((s.modules.ledger ?? 0) < 1) return NextResponse.json({ error: "yetkisiz" }, { status: 403 });
  const u = new URL(req.url);
  const id = u.searchParams.get("paket") ?? "";
  const xls = u.searchParams.get("bicim") === "xls";
  if (!/^[0-9a-f-]{36}$/.test(id)) return NextResponse.json({ error: "paket" }, { status: 400 });
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("gl_luca_batch", { p_batch: id });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  const d = data as LucaBatchData;

  const files = lucaBatchFiles(d, xls);

  if (!files.length) return NextResponse.json({ error: "Pakette fiş yok" }, { status: 400 });
  if (files.length === 1) {
    const f = files[0]!;
    return new NextResponse(new Uint8Array(f.buf), { headers: { "Content-Type": xls ? "application/vnd.ms-excel" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="${f.name}"` } });
  }
  const zip = new JSZip();
  for (const f of files) zip.file(f.name, f.buf);
  const out = await zip.generateAsync({ type: "uint8array" });
  return new NextResponse(out as unknown as BodyInit, { headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="luca-paket${d.batch.no}.zip"` } });
}
