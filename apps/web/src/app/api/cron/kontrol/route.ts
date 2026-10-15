import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Sabah kontrol raporu (Vercel Cron, her sabah 07:30): Kontrol Merkezi denetimleri + yöneticilere bildirim */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "yetkisiz" }, { status: 401 });
  let admin;
  try { admin = createAdminClient(); } catch { return NextResponse.json({ error: "ayarlı değil" }, { status: 501 }); }
  const { data, error } = await admin.rpc("admin_morning_report");
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  // Muhasebe kokpiti sabah özeti (kurulmadıysa sessizce geçilir)
  const gl = await admin.rpc("gl_morning_digest");
  return NextResponse.json({ ok: true, ...(data as object), muhasebe: gl.error ? { error: gl.error.message } : gl.data });
}
