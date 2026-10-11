import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { waMedia } from "@/lib/whatsapp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** WhatsApp medyası (yalnız İK; mesaj bu şirkete ait olmalı) */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await getSession();
  if ((s.modules.hr ?? 0) < 1) return new NextResponse("Yetkiniz yok", { status: 403 });
  const supabase = await createClient();
  const { data } = await supabase.from("wa_messages").select("id, filename").eq("media_id", id).maybeSingle();
  if (!data) return new NextResponse("Bulunamadı", { status: 404 });
  try {
    const m = await waMedia(id);
    const inline = /^(image\/(jpeg|png|webp)|application\/pdf|audio\/(ogg|mpeg|mp4|aac))/.test(m.mime);
    return new NextResponse(m.data, { headers: { "Content-Type": inline ? m.mime.split(";")[0]! : "application/octet-stream", "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent((data.filename as string | null) ?? "dosya")}`, "X-Content-Type-Options": "nosniff", "Cache-Control": "private, max-age=3600" } });
  } catch {
    return new NextResponse("Medya alınamadı (WhatsApp medyası 30 gün saklanır)", { status: 502, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
}
