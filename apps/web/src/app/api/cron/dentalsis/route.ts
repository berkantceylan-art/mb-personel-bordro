import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { runDsisSync } from "@/lib/dsis-sync";

export const dynamic = "force-dynamic";
export const maxDuration = 280;

/** 5 dakikada bir: Dentalsis'teki yeni / değişen işler, hekimler, provalar ve tahsilatlar ERP'ye (Vercel Cron) */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "yetkisiz" }, { status: 401 });
  const res = await runDsisSync(createAdminClient());
  return NextResponse.json(res, { status: res.ok ? 200 : 500 });
}
