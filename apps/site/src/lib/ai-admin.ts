"use server";

import { aiEnabled, assistantSystem, claude, type AiMessage } from "./ai";
import { requireSiteEditor } from "./auth";
import { createClient } from "./supabase/server";

type Res<T> = { data?: T; error?: string };

function parseJson<T>(text: string): T | null {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    return JSON.parse(m[0]) as T;
  } catch {
    return null;
  }
}

const fail = (e: unknown) => ({ error: (e as Error).message === "ai_disabled" ? "Yapay zekâ anahtarı tanımlı değil." : "Yapay zekâ şu an cevap vermedi, tekrar deneyin." });

/** Türkçe metni İngilizce ve Fransızcaya çevirir (biçim işaretleri korunur) */
export async function aiTranslate(text: string): Promise<Res<{ en: string; fr: string }>> {
  await requireSiteEditor();
  if (!aiEnabled()) return { error: "Yapay zekâ anahtarı tanımlı değil." };
  const src = String(text ?? "").trim().slice(0, 8000);
  if (!src) return { error: "Önce Türkçe metni yazın." };
  try {
    const out = await claude({
      system:
        "You are a professional translator for MB Dental, a digital dental laboratory in İzmir, Türkiye, serving dentists and clinics. Translate Turkish website text into natural, professional English and French used by dental professionals (correct dental terminology: zirconia/zircone, crown/couronne, abutment/pilier, etc.). Keep line breaks and these formatting markers exactly: lines starting with '## ', '> ', '- '. Do not add content. Reply ONLY with JSON: {\"en\": \"...\", \"fr\": \"...\"}",
      messages: [{ role: "user", content: src }],
      maxTokens: 3000,
      temperature: 0.2,
    });
    const j = parseJson<{ en?: string; fr?: string }>(out);
    if (!j?.en || !j?.fr) return { error: "Çeviri okunamadı, tekrar deneyin." };
    return { data: { en: j.en, fr: j.fr } };
  } catch (e) {
    return fail(e);
  }
}

/** Sayfa / ürün için 3 dilde SEO başlığı ve açıklaması önerir */
export async function aiSeo(input: { title: string; summary: string; body: string }): Promise<Res<{ title: Record<"tr" | "en" | "fr", string>; description: Record<"tr" | "en" | "fr", string> }>> {
  await requireSiteEditor();
  if (!aiEnabled()) return { error: "Yapay zekâ anahtarı tanımlı değil." };
  const title = String(input.title ?? "").trim();
  if (!title) return { error: "Önce Türkçe başlığı yazın." };
  try {
    const out = await claude({
      system:
        "You write SEO metadata for MB Dental (digital dental laboratory, İzmir, Türkiye; serves dentists, clinics and agencies in Türkiye and abroad). For the given page, write a search title (max 60 characters, include 'MB Dental' at the end when it fits) and a meta description (140-160 characters, clear benefit + call to action, no exaggerated claims, no prices) in Turkish, English and French. Reply ONLY with JSON: {\"title\": {\"tr\": \"\", \"en\": \"\", \"fr\": \"\"}, \"description\": {\"tr\": \"\", \"en\": \"\", \"fr\": \"\"}}",
      messages: [{ role: "user", content: `Başlık: ${title}\nÖzet: ${String(input.summary ?? "").slice(0, 600)}\nMetin: ${String(input.body ?? "").slice(0, 3000)}` }],
      maxTokens: 900,
    });
    const j = parseJson<{ title?: Record<string, string>; description?: Record<string, string> }>(out);
    if (!j?.title?.tr || !j?.description?.tr) return { error: "Öneri okunamadı, tekrar deneyin." };
    const pick = (o: Record<string, string>) => ({ tr: o.tr ?? "", en: o.en ?? "", fr: o.fr ?? "" });
    return { data: { title: pick(j.title), description: pick(j.description) } };
  } catch (e) {
    return fail(e);
  }
}

/** Canlı destek: ekibe cevap taslağı önerir */
export async function aiChatSuggest(chatId: string): Promise<Res<string>> {
  await requireSiteEditor();
  if (!aiEnabled()) return { error: "Yapay zekâ anahtarı tanımlı değil." };
  const supabase = await createClient();
  const [{ data: chat }, { data: msgs }] = await Promise.all([
    supabase.from("cms_chats").select("name, locale").eq("id", chatId).maybeSingle(),
    supabase.from("cms_chat_messages").select("sender, body").eq("chat_id", chatId).order("id").limit(60),
  ]);
  if (!chat || !msgs?.length) return { error: "Konuşma bulunamadı." };
  const history: AiMessage[] = [];
  for (const m of msgs as { sender: string; body: string }[]) {
    const role = m.sender === "visitor" ? "user" : "assistant";
    const last = history[history.length - 1];
    if (last && last.role === role) last.content += `\n${m.body}`;
    else history.push({ role, content: m.body });
  }
  if (history[0]?.role !== "user") history.shift();
  if (history[history.length - 1]?.role !== "user") history.push({ role: "user", content: "(Ziyaretçi henüz yeni bir şey yazmadı; konuşmayı sürdürecek kısa bir takip mesajı öner.)" });
  try {
    const sys = `${await assistantSystem(chat.locale ?? "tr")}\n\nŞu an laboratuvar ekibinden birinin göndereceği cevabın TASLAĞINI yazıyorsun. Ekip adına birinci çoğul şahısla yaz ("kontrol edip dönüyoruz"). Yalnız mesaj metnini yaz.`;
    const out = await claude({ system: sys, messages: history, maxTokens: 400 });
    return out ? { data: out } : { error: "Öneri üretilemedi." };
  } catch (e) {
    return fail(e);
  }
}
