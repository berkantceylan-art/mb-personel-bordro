"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import { waConfigured, waSendTemplate, waSendText } from "@/lib/whatsapp";

const SQL = "Supabase'de 20270112000000_whatsapp.sql çalıştırılmalı.";

/** İK yanıtı: WhatsApp'tan gönder, kaydet, görevi kapat (24 saat geçtiyse şablonla) */
export async function waReply(thread: string, body: string, close = true): Promise<{ ok: boolean; message: string }> {
  const s = await getSession();
  if ((s.modules.hr ?? 0) < 2) return { ok: false, message: "Yanıt için İK düzenleme yetkisi gerekir." };
  const text = body.trim().slice(0, 4000);
  if (!text) return { ok: false, message: "Yanıt yazın." };
  if (!waConfigured()) return { ok: false, message: "WhatsApp bağlantısı kurulmamış (Vercel: WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID)." };
  const supabase = await createClient();
  const { data: t, error } = await supabase.from("wa_threads").select("id, wa_id, last_in_at").eq("id", thread).maybeSingle();
  if (error) return { ok: false, message: /wa_threads/.test(error.message) ? SQL : error.message };
  if (!t) return { ok: false, message: "Konuşma bulunamadı." };
  const open = t.last_in_at && Date.now() - new Date(t.last_in_at as string).getTime() < 24 * 3600 * 1000;
  let sent: { id: string }; let type = "text";
  try {
    if (open) sent = await waSendText(t.wa_id as string, text);
    else { sent = await waSendTemplate(t.wa_id as string, text); type = "template"; }
  } catch (e) {
    const m = (e as Error).message;
    if (m === "window_closed" || m === "no_template") return { ok: false, message: "Personelin son mesajının üzerinden 24 saat geçti; WhatsApp yalnız onaylı şablonla mesaja izin verir. Vercel'e WHATSAPP_TEMPLATE (onaylı şablon adı) eklenmeli." };
    return { ok: false, message: `Gönderilemedi: ${m}` };
  }
  const { error: e2 } = await supabase.rpc("wa_outbound", { p_thread: thread, p_body: text, p_wa_message_id: sent.id, p_type: type, p_close: close });
  if (e2) return { ok: false, message: e2.message };
  revalidatePath("/ik-whatsapp");
  revalidatePath("/");
  return { ok: true, message: close ? "Gönderildi; görev kapandı." : "Gönderildi." };
}

export async function waThreadAction(thread: string, action: "close" | "open" | "read" | "assign" | "employee", employee?: string | null) {
  const supabase = await createClient();
  await supabase.rpc("wa_thread_action", { p_thread: thread, p_action: action, p_employee: employee ?? null });
  revalidatePath("/ik-whatsapp");
  revalidatePath("/");
}
