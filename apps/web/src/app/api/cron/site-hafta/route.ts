import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Pazartesi 08:45: haftalık site raporu (ziyaretçi, kaynak, form, yapay zekâ, 404) site yöneticilerine bildirim */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "yetkisiz" }, { status: 401 });
  let admin;
  try { admin = createAdminClient(); } catch { return NextResponse.json({ error: "ayarlı değil" }, { status: 501 }); }
  const { data, error } = await admin.rpc("site_weekly_report");
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, ...(data as object) });
}
