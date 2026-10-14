import { NextResponse } from "next/server";
import { sendPortalStatusNotices } from "@/lib/portal-notify";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** 10 dakikada bir: portal vaka durumu değişikliklerini hekime e-posta / WhatsApp ile bildirir (Vercel Cron) */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "yetkisiz" }, { status: 401 });
  try { return NextResponse.json({ ok: true, ...(await sendPortalStatusNotices()) }); } catch (e) { return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 }); }
}
