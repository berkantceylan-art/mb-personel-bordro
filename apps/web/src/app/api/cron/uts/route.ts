import { NextResponse } from "next/server";
import { sendUtsQueue } from "@/lib/uts";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** 15 dakikada bir: bekleyen ÜTS bildirimlerini (alma, kullanım, verme) gönderir (Vercel Cron) */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "yetkisiz" }, { status: 401 });
  try { return NextResponse.json({ ok: true, ...(await sendUtsQueue()) }); } catch (e) { return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 }); }
}
