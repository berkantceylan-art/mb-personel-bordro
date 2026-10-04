"use server";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";

type Sub = { endpoint: string; keys: { p256dh: string; auth: string } };

export async function saveWebPush(sub: Sub, userAgent: string): Promise<{ ok: boolean; message?: string }> {
  const s = await getSession();
  if (!sub?.endpoint?.startsWith("https://") || !sub.keys?.p256dh || !sub.keys?.auth) return { ok: false, message: "Geçersiz abonelik" };
  const supabase = await createClient();
  // Aynı cihaz başka kullanıcıya kayıtlıysa önce kendi kaydımızı temizleyip yeniden ekleriz
  const { error } = await supabase
    .from("web_push_subscriptions")
    .upsert({ endpoint: sub.endpoint, user_id: s.userId, company_id: s.companyId, p256dh: sub.keys.p256dh, auth: sub.keys.auth, user_agent: userAgent.slice(0, 200) });
  return error ? { ok: false, message: error.message } : { ok: true };
}

export async function removeWebPush(endpoint: string) {
  await getSession();
  const supabase = await createClient();
  await supabase.from("web_push_subscriptions").delete().eq("endpoint", endpoint);
}
