import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { elogoConfigured, elogoSync } from "@/lib/elogo";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Saatlik: eLogo'dan gelen ve giden e-fatura, e-arşiv, e-irsaliye (son 3 gün) */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "yetkisiz" }, { status: 401 });
  if (!elogoConfigured()) return NextResponse.json({ ok: true, skipped: "eLogo kullanıcısı tanımlı değil" });
  let admin;
  try { admin = createAdminClient(); } catch { return NextResponse.json({ error: "ayarlı değil" }, { status: 501 }); }
  const { data: set } = await admin.from("einv_settings").select("elogo_enabled").maybeSingle();
  if (!set?.elogo_enabled) return NextResponse.json({ ok: true, skipped: "eşitleme kapalı" });
  const to = new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 10);
  const from = new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10);
  try {
    const r = await elogoSync(admin, { from, to, max: 150 });
    return NextResponse.json({ ok: r.ok, message: r.message });
  } catch (e) {
    await admin.rpc("einv_elogo_log", { p_log: { error: (e as Error).message.slice(0, 300), from, to } });
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
