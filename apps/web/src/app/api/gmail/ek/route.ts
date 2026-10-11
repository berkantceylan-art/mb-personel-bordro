import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/session";
import { accessToken, getAttachment, GmailError } from "@/lib/gmail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SAFE_INLINE = /^(image\/(png|jpe?g|gif|webp)|application\/pdf)$/i;

/** E-posta eki indir: ?a=hesap&m=ileti&id=ek&n=ad&t=tür[&g=1 görüntüle] */
export async function GET(req: NextRequest) {
  const s = await getSession();
  const sp = req.nextUrl.searchParams;
  const a = sp.get("a") ?? "", m = sp.get("m") ?? "", id = sp.get("id") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(a) || !/^[0-9a-zA-Z_-]{6,64}$/.test(m) || !id || id.length > 2000) return new NextResponse("Geçersiz istek", { status: 400 });
  try {
    const { token } = await accessToken(a, s.userId);
    const data = await getAttachment(token, m, id);
    const name = (sp.get("n") ?? "ek").replace(/[\r\n"]/g, "").slice(0, 180) || "ek";
    const type = (sp.get("t") ?? "").toLowerCase();
    const inline = sp.get("g") === "1" && SAFE_INLINE.test(type);
    return new NextResponse(new Uint8Array(data), {
      headers: {
        "Content-Type": inline ? type : "application/octet-stream",
        "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(name)}`,
        "X-Content-Type-Options": "nosniff",
        ...(type === "application/pdf" && inline ? {} : { "Content-Security-Policy": "sandbox" }),
        "Cache-Control": "private, max-age=600",
      },
    });
  } catch (e) {
    const st = e instanceof GmailError ? e.status : 500;
    return new NextResponse(e instanceof GmailError ? e.message : "Ek alınamadı", { status: st >= 400 && st < 600 ? st : 500, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
}
