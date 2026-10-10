import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/session";

export const runtime = "nodejs";

/** SGK Robotu Chrome eklentisi: bu yazılımın adresiyle yapılandırılmış zip */
export async function GET(req: NextRequest) {
  const s = await getSession();
  if (!["owner", "hr", "accountant"].includes(s.role)) return new NextResponse("Yetkiniz yok", { status: 403 });
  const origin = req.nextUrl.origin;
  const dir = path.join(process.cwd(), "src", "sgk-robot");
  const zip = new JSZip();
  const folder = zip.folder("mb-sgk-robotu")!;
  for (const f of await readdir(dir)) {
    const buf = await readFile(path.join(dir, f));
    if (/\.(js|json|html)$/.test(f)) folder.file(f, buf.toString("utf8").replaceAll("__APP_ORIGIN__", origin));
    else folder.file(f, buf);
  }
  const out = await zip.generateAsync({ type: "uint8array" });
  return new NextResponse(out as unknown as BodyInit, { headers: { "Content-Type": "application/zip", "Content-Disposition": 'attachment; filename="mb-sgk-robotu.zip"' } });
}
