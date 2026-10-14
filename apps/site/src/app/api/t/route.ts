import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { geoFrom, isBotUa, uaInfo, visitorHash } from "@/lib/track";

export const dynamic = "force-dynamic";

type Body = { t?: string; path?: string; ref?: string; name?: string; id?: number; ms?: number; session?: string; utm_source?: string; utm_campaign?: string; locale?: string };

/** Site istatistiği toplama (sayfa görüntüleme, olay, sayfada kalma süresi) — çerez kullanmaz */
export async function POST(req: Request) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return NextResponse.json({});
  const ua = req.headers.get("user-agent") ?? "";
  if (!ua || isBotUa(ua)) return NextResponse.json({});
  let b: Body;
  try { b = JSON.parse(await req.text()) as Body; } catch { return NextResponse.json({}); }
  const visitor = visitorHash(req.headers);
  const supabase = await createClient();
  if (b.t === "ms" && typeof b.id === "number" && typeof b.ms === "number") {
    await supabase.rpc("site_track_ms", { p_id: b.id, p_visitor: visitor, p_ms: Math.round(b.ms) });
    return NextResponse.json({});
  }
  if (b.t !== "view" && b.t !== "event") return NextResponse.json({});
  const path = String(b.path ?? "").slice(0, 300);
  if (!path.startsWith("/") || path.startsWith("/admin") || path.startsWith("/api")) return NextResponse.json({});
  let ref: string | null = null;
  try { ref = b.ref ? new URL(b.ref).hostname.replace(/^www\./, "") : null; } catch { ref = null; }
  const host = req.headers.get("host")?.replace(/^www\./, "");
  if (ref && host && ref === host) ref = null;
  const { data } = await supabase.rpc("site_track", { p: {
    kind: b.t, name: b.t === "event" ? String(b.name ?? "").slice(0, 60) : null, path, locale: b.locale ?? path.split("/")[1]?.slice(0, 5),
    ref, utm_source: b.utm_source ?? null, utm_campaign: b.utm_campaign ?? null, ...geoFrom(req.headers), ...uaInfo(ua), visitor, session: String(b.session ?? "").slice(0, 32) || null,
  } });
  return NextResponse.json({ id: data ?? null });
}
