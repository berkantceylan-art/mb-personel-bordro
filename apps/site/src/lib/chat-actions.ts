"use server";

import { createHash, randomBytes } from "node:crypto";
import { cookies, headers } from "next/headers";
import { hasSupabase } from "./cms";
import type { ChatMessage, ChatSnapshot } from "./chat-ui";
import { aiEnabled, assistantSystem, claude, type AiMessage } from "./ai";
import { openState } from "./hours";
import { isLocale } from "./i18n";
import { getSettings } from "./settings";
import { createClient } from "./supabase/server";

/**
 * Sitedeki canlı destek (ziyaretçi tarafı).
 * Sohbet kimliği ve gizli anahtar yalnız httpOnly çerezde durur; tarayıcı
 * JavaScript'i anahtarı göremez. Veritabanı anahtarın yalnız özetini saklar.
 */
const COOKIE = "mb-destek";
const MAX_AGE = 60 * 60 * 24 * 30;

async function readCookie(): Promise<{ id: string; token: string } | null> {
  const raw = (await cookies()).get(COOKIE)?.value ?? "";
  const m = /^([0-9a-f-]{36})\.([A-Za-z0-9_-]{40,})$/.exec(raw);
  return m ? { id: m[1], token: m[2] } : null;
}

async function ipHash(): Promise<string | null> {
  const h = await headers();
  const ip = (h.get("x-forwarded-for") ?? h.get("x-real-ip") ?? "").split(",")[0].trim();
  const day = new Date().toISOString().slice(0, 10);
  return ip ? createHash("sha256").update(`mbdental:${day}:${ip}`).digest("hex").slice(0, 32) : null;
}

type Poll = { status: "open" | "closed"; name: string; messages: ChatMessage[] } | null;

/** Mevcut sohbetin yeni mesajları (after: son görülen mesaj no) */
export async function chatState(after = 0): Promise<ChatSnapshot> {
  if (!hasSupabase()) return { chat: null };
  const c = await readCookie();
  if (!c) return { chat: null };
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("chat_poll", { p_chat: c.id, p_token: c.token, p_after: Math.max(0, Math.floor(after) || 0) });
    if (error) return { chat: null, error: "server" };
    const d = data as Poll;
    if (!d) return { chat: null };
    return { chat: { status: d.status, name: d.name, messages: d.messages ?? [] } };
  } catch {
    return { chat: null, error: "server" };
  }
}

export type ChatStartInput = { name: string; email: string; body: string; locale: string; page: string; t: number; website: string };

export async function chatStart(input: ChatStartInput): Promise<ChatSnapshot> {
  // Bot tuzakları
  if (input.website) return { chat: null };
  if (!input.t || Date.now() - input.t < 2000) return { chat: null, error: "spam" };
  const name = String(input.name ?? "").trim().slice(0, 120);
  const email = String(input.email ?? "").trim().slice(0, 200);
  const body = String(input.body ?? "").trim().slice(0, 2000);
  if (!name || !body) return { chat: null, error: "required" };
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { chat: null, error: "email" };
  if (!hasSupabase()) return { chat: null, error: "server" };

  const token = randomBytes(32).toString("base64url");
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("chat_start", {
      p_token: token,
      p_name: name,
      p_email: email || null,
      p_body: body,
      p_locale: isLocale(input.locale) ? input.locale : null,
      p_page: String(input.page ?? "").slice(0, 300) || null,
      p_ip_hash: await ipHash(),
    });
    if (error) return { chat: null, error: error.message.includes("rate_limited") ? "rate" : "server" };
    const id = String(data);
    (await cookies()).set(COOKIE, `${id}.${token}`, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: MAX_AGE });
  } catch {
    return { chat: null, error: "server" };
  }
  return chatState(0);
}

export async function chatSend(body: string, after = 0): Promise<ChatSnapshot> {
  const c = await readCookie();
  if (!c) return { chat: null, error: "gone" };
  const text = String(body ?? "").trim().slice(0, 2000);
  if (!text) return chatState(after);
  try {
    const supabase = await createClient();
    const { error } = await supabase.rpc("chat_send", { p_chat: c.id, p_token: c.token, p_body: text });
    if (error) {
      if (error.message.includes("not_found")) return { chat: null, error: "gone" };
      return { ...(await chatState(after)), error: error.message.includes("rate_limited") ? "rate" : "server" };
    }
  } catch {
    return { ...(await chatState(after)), error: "server" };
  }
  return chatState(after);
}

/** Ziyaretçi yeni bir konuşma başlatmak isterse eski çerezi siler */
export async function chatForget(): Promise<void> {
  (await cookies()).delete(COOKIE);
}

/**
 * Yapay zekâ asistanı cevabı: ayar ve saatlere göre, ekip henüz yazmadıysa
 * son ziyaretçi mesajına cevap üretir ve sohbete "bot" mesajı olarak ekler.
 */
export async function chatBot(after = 0, locale = "tr"): Promise<ChatSnapshot> {
  const c = await readCookie();
  if (!c || !aiEnabled()) return chatState(after);
  const st = await getSettings();
  if (!st.chat_enabled || st.ai_assistant === "off") return chatState(after);
  if (st.ai_assistant === "offline") {
    const now = openState(st.schedule, "tr");
    if (now?.open) return chatState(after);
  }
  try {
    const supabase = await createClient();
    const { data } = await supabase.rpc("chat_poll", { p_chat: c.id, p_token: c.token, p_after: 0 });
    const d = data as Poll;
    if (!d?.messages?.length) return chatState(after);
    const msgs = d.messages;
    if (msgs.some((m) => m.sender === "staff") || msgs[msgs.length - 1].sender !== "visitor") return chatState(after);
    // Sohbeti Claude mesaj biçimine çevir (ardışık aynı rol birleştirilir)
    const history: AiMessage[] = [];
    for (const m of msgs.slice(-20)) {
      const role = m.sender === "visitor" ? "user" : "assistant";
      const last = history[history.length - 1];
      if (last && last.role === role) last.content += `\n${m.body}`;
      else history.push({ role, content: m.body });
    }
    if (history[0]?.role !== "user") history.shift();
    const text = await claude({ system: await assistantSystem(isLocale(locale) ? locale : "tr"), messages: history, maxTokens: 450 });
    if (text) await supabase.rpc("chat_bot_reply", { p_chat: c.id, p_token: c.token, p_body: text.slice(0, 2000) });
  } catch {
    // Asistan çalışmazsa sessizce geç: ziyaretçi ekibin cevabını bekler
  }
  return chatState(after);
}
