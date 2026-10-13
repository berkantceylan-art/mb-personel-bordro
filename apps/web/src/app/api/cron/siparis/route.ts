import { NextResponse } from "next/server";
import { sendQueuedPOs } from "@/lib/po-send";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** 10 dakikada bir: onaylanıp gönderilemeyen satın alma siparişlerini tedarikçiye yeniden dener (Vercel Cron). */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "yetkisiz" }, { status: 401 });
  const r = await sendQueuedPOs(25);
  return NextResponse.json({ ok: true, ...r });
}
