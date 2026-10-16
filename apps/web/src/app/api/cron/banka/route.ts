import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { scanBankMail } from "@/lib/bank-mail";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Banka ekstresi e-postaları (Vercel Cron, 15 dakikada bir) */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "yetkisiz" }, { status: 401 });
  try {
    return NextResponse.json(await scanBankMail(createAdminClient()));
  } catch (e) {
    return NextResponse.json({ ok: false, message: (e as Error).message }, { status: 500 });
  }
}
