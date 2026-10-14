import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { geoFrom, uaInfo, visitorHash } from "@/lib/track";

/** Sunucu tarafında olay kaydı (form gönderimi, randevu, kayıt…): istatistik hatası işi bozmaz */
export async function siteEvent(name: string, path?: string) {
  try {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return;
    const h = await headers();
    let p = path ?? "/";
    try { const r = h.get("referer"); if (!path && r) p = new URL(r).pathname; } catch { /* yok */ }
    const supabase = await createClient();
    await supabase.rpc("site_track", { p: { kind: "event", name, path: p.slice(0, 300), ...geoFrom(h), ...uaInfo(h.get("user-agent") ?? ""), visitor: visitorHash(h) } });
  } catch { /* istatistik isteğe bağlı */ }
}
