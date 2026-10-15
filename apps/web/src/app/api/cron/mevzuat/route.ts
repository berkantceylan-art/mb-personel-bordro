import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { MEVZUAT, areaOf, severityOf } from "@/lib/mevzuat";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Her sabah: yeni mevzuat gelişmelerini ilgili kişilere bildir, son günü yaklaşan aksiyonları hatırlat */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "yetkisiz" }, { status: 401 });
  let admin;
  try { admin = createAdminClient(); } catch { return NextResponse.json({ error: "ayarlı değil" }, { status: 501 }); }
  const items = MEVZUAT.bulletin.map((b) => ({
    id: b.id, title: b.title, date: b.date, area: areaOf(b), severity: severityOf(b), due: b.due ?? null,
    note: (b.action ?? b.summary).slice(0, 280),
  }));
  const { data, error } = await admin.rpc("reg_notify", { p_items: items });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, ...(data as object) });
}
