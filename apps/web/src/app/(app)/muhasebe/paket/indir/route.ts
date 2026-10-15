import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import { PACKAGE_PARTS, buildPackage } from "@/lib/gl-package";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Mali müşavir paketi: ayın raporları ve Luca dosyaları tek ZIP */
export async function GET(req: Request) {
  const s = await getSession();
  if ((s.modules.ledger ?? 0) < 1) return NextResponse.json({ error: "yetkisiz" }, { status: 403 });
  const u = new URL(req.url);
  const ay = u.searchParams.get("ay") ?? "";
  if (!/^\d{4}-\d{2}$/.test(ay)) return NextResponse.json({ error: "ay" }, { status: 400 });
  const parts = u.searchParams.getAll("p").filter((p) => PACKAGE_PARTS.some(([k]) => k === p));
  const supabase = await createClient();
  const { data: co } = await supabase.from("companies").select("name").limit(1).maybeSingle();
  const pkg = await buildPackage(supabase, ay, (co?.name as string) || "MB Dental", parts.length ? parts : undefined);
  await supabase.rpc("gl_package_log", { p_period: ay, p_kind: "download", p_to: null, p_files: pkg.files, p_size: pkg.zip.length, p_error: null });
  return new NextResponse(new Uint8Array(pkg.zip), { headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="${pkg.name}"` } });
}
