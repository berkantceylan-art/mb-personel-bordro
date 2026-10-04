import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import webpush from "web-push";

export const runtime = "nodejs";

/**
 * Veritabanı yeni bir bildirim yazınca buraya { id } gönderir.
 * Bildirim service_role ile okunur, kullanıcının telefon aboneliklerine gönderilir.
 * Her bildirim yalnız bir kez ve yalnız ilk 10 dakika içinde gönderilir (tekrar oynatılamaz).
 */
export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!url || !key || !pub || !priv) return NextResponse.json({ error: "push ayarlı değil" }, { status: 501 });

  const { id } = (await req.json().catch(() => ({}))) as { id?: string };
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "geçersiz" }, { status: 400 });

  const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const since = new Date(Date.now() - 10 * 60_000).toISOString();
  const { data: n } = await admin
    .from("notifications")
    .update({ pushed_at: new Date().toISOString() })
    .eq("id", id)
    .is("pushed_at", null)
    .gte("created_at", since)
    .select("user_id, title, body, link")
    .maybeSingle();
  if (!n) return NextResponse.json({ ok: true, sent: 0 });

  const { data: subs } = await admin.from("web_push_subscriptions").select("endpoint, p256dh, auth").eq("user_id", n.user_id);
  webpush.setVapidDetails("mailto:destek@mbdental.app", pub, priv);
  const link = n.link && n.link.startsWith("/") && !n.link.startsWith("//") ? n.link : "/";
  const payload = JSON.stringify({ title: n.title, body: n.body ?? "", link, tag: link.startsWith("/mesajlar/") ? link : undefined });
  let sent = 0;
  await Promise.all(
    (subs ?? []).map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 3600, urgency: "high" });
        sent++;
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) await admin.from("web_push_subscriptions").delete().eq("endpoint", s.endpoint);
      }
    }),
  );
  return NextResponse.json({ ok: true, sent });
}
