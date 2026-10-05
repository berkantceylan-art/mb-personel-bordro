"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSiteEditor } from "./auth";
import type { ChatMessage } from "./chat-ui";
import { createClient } from "./supabase/server";

export type AdminChat = {
  id: string;
  name: string;
  email: string | null;
  locale: string | null;
  page: string | null;
  status: "open" | "closed";
  note: string | null;
  last_message_at: string;
  last_visitor_at: string;
  staff_read_at: string | null;
  visitor_seen_at: string;
  created_at: string;
};

export type ThreadSnapshot = { chat: AdminChat | null; messages: ChatMessage[]; error?: string };

/** Konuşmanın yeni mesajları; açan editör için "okundu" işaretler */
export async function adminChatThread(id: string, after = 0): Promise<ThreadSnapshot> {
  await requireSiteEditor();
  const supabase = await createClient();
  const [{ data: chat }, { data: msgs, error }] = await Promise.all([
    supabase.from("cms_chats").select("id, name, email, locale, page, status, note, last_message_at, last_visitor_at, staff_read_at, visitor_seen_at, created_at").eq("id", id).maybeSingle(),
    supabase.from("cms_chat_messages").select("id, sender, body, created_at").eq("chat_id", id).gt("id", Math.max(0, after)).order("id").limit(500),
  ]);
  if (!chat) return { chat: null, messages: [], error: error?.message };
  const c = chat as AdminChat;
  if (!c.staff_read_at || c.last_visitor_at > c.staff_read_at) {
    await supabase.from("cms_chats").update({ staff_read_at: new Date().toISOString() }).eq("id", id);
  }
  return {
    chat: c,
    messages: ((msgs ?? []) as { id: number; sender: "visitor" | "staff"; body: string; created_at: string }[]).map((m) => ({ id: m.id, sender: m.sender, body: m.body, at: m.created_at })),
  };
}

export async function adminChatReply(id: string, body: string, after = 0): Promise<ThreadSnapshot> {
  const u = await requireSiteEditor();
  const text = String(body ?? "").trim().slice(0, 2000);
  if (text) {
    const supabase = await createClient();
    const { error } = await supabase.from("cms_chat_messages").insert({ chat_id: id, sender: "staff", body: text, staff_id: u.id });
    if (error) return { ...(await adminChatThread(id, after)), error: `Gönderilemedi: ${error.message}` };
  }
  return adminChatThread(id, after);
}

export async function setChatStatus(form: FormData) {
  await requireSiteEditor();
  const id = String(form.get("id") ?? "");
  const status = form.get("status") === "closed" ? "closed" : "open";
  const supabase = await createClient();
  await supabase.from("cms_chats").update({ status, staff_read_at: new Date().toISOString() }).eq("id", id);
  revalidatePath("/admin", "layout");
  redirect(`/admin/canli-destek/${id}?ok=${encodeURIComponent(status === "closed" ? "Konuşma kapatıldı." : "Konuşma yeniden açıldı.")}`);
}

export async function saveChatNote(form: FormData) {
  await requireSiteEditor();
  const id = String(form.get("id") ?? "");
  const note = String(form.get("note") ?? "").trim().slice(0, 2000) || null;
  const supabase = await createClient();
  await supabase.from("cms_chats").update({ note }).eq("id", id);
  redirect(`/admin/canli-destek/${id}?ok=${encodeURIComponent("Not kaydedildi.")}`);
}

export async function deleteChat(form: FormData) {
  await requireSiteEditor();
  const id = String(form.get("id") ?? "");
  const supabase = await createClient();
  await supabase.from("cms_chats").delete().eq("id", id);
  revalidatePath("/admin", "layout");
  redirect(`/admin/canli-destek?ok=${encodeURIComponent("Konuşma silindi.")}`);
}

/** Konuşmayı gelen kutusuna mesaj olarak aktarır (e-postayla takip için) */
export async function chatToInbox(form: FormData) {
  await requireSiteEditor();
  const id = String(form.get("id") ?? "");
  const supabase = await createClient();
  const { data: chat } = await supabase.from("cms_chats").select("name, email, locale, page").eq("id", id).maybeSingle();
  const { data: msgs } = await supabase.from("cms_chat_messages").select("sender, body, created_at").eq("chat_id", id).order("id").limit(500);
  if (!chat || !chat.email) redirect(`/admin/canli-destek/${id}?hata=${encodeURIComponent("Ziyaretçi e-posta bırakmamış; gelen kutusuna aktarılamaz.")}`);
  const transcript = ((msgs ?? []) as { sender: string; body: string; created_at: string }[])
    .map((m) => `[${new Date(m.created_at).toLocaleString("tr-TR", { timeZone: "Europe/Istanbul" })}] ${m.sender === "visitor" ? chat.name : "MB Dental"}: ${m.body}`)
    .join("\n")
    .slice(0, 5000);
  const { error } = await supabase.from("cms_messages").insert({
    topic: "general",
    name: chat.name,
    email: chat.email,
    message: transcript || "(boş)",
    meta: { source: "chat", chat_id: id },
    locale: chat.locale,
    page: chat.page,
    status: "read",
  });
  if (error) redirect(`/admin/canli-destek/${id}?hata=${encodeURIComponent(`Aktarılamadı: ${error.message}`)}`);
  redirect(`/admin/canli-destek/${id}?ok=${encodeURIComponent("Konuşma gelen kutusuna aktarıldı.")}`);
}
