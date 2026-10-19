import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { pollDhl } from "@/lib/dhl";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Saatte bir (07–22): bekleyen DHL gönderilerinin durumunu DHL'den çeker (Vercel Cron) */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "yetkisiz" }, { status: 401 });
  try { return NextResponse.json({ ok: true, ...(await pollDhl(createAdminClient(), 15)) }); } catch (e) { return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 }); }
}
