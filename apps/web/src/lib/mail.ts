// Posta modülü: sunucu ve tarayıcıda ortak tipler / sabitler (fonksiyon ve sabitler "use client" dosyasına konmaz)

export type MailAccount = { id: string; email: string; display_name: string | null; color: string; status: string; last_error: string | null; signature: string | null };
export type ThreadRow = { id: string; subject: string; from: string; fromEmail: string; snippet: string; date: string; unread: boolean; starred: boolean; count: number; hasAttachment: boolean; labels: string[] };
export type Attachment = { id: string; name: string; mime: string; size: number };
export type Message = { id: string; from: string; to: string; cc: string; date: string; subject: string; html: string | null; text: string; attachments: Attachment[]; messageId: string; references: string; unread: boolean };
export type Label = { id: string; name: string; type: string };
export type AiAction = { kind: "order" | "lead" | "reminder" | "reply" | "task"; text: string; due?: string | null };
export type MailAi = { category: string | null; urgency: number | null; summary: string | null; actions: AiAction[]; reply: string | null; done: boolean; history: string | null };
export type ListAi = { urgency: number | null; category: string | null; summary: string | null; done: boolean };
export type MailLinkRow = { id: string; entity: string; entity_id: string | null; note: string | null; created_at: string };
export type ThreadView = { id: string; subject: string; messages: Message[]; labels: string[]; ai: MailAi | null; links: MailLinkRow[]; customer: { id: string; name: string } | null };

export const FOLDERS: { id: string; label: string; icon: string; q?: string }[] = [
  { id: "INBOX", label: "Gelen kutusu", icon: "📥" },
  { id: "STARRED", label: "Yıldızlı", icon: "⭐" },
  { id: "IMPORTANT", label: "Önemli", icon: "🏷" },
  { id: "SENT", label: "Gönderilenler", icon: "📤" },
  { id: "DRAFT", label: "Taslaklar", icon: "📝" },
  { id: "ALL", label: "Tüm postalar", icon: "🗂" },
  { id: "SPAM", label: "Spam", icon: "⚠️" },
  { id: "TRASH", label: "Çöp kutusu", icon: "🗑" },
];
export const COUNTED = ["INBOX", "DRAFT", "SPAM"];

export const CATEGORY_LABELS: Record<string, string> = {
  case: "Vaka / iş", question: "Soru", complaint: "Şikâyet", price: "Fiyat", invoice: "Fatura / ödeme", order: "Sipariş", info: "Bilgi", spam: "Reklam / spam", other: "Diğer",
};
export const URGENCY = ["Düşük", "Normal", "Önemli", "Acil"];
export const ACTION_LABELS: Record<AiAction["kind"], string> = { order: "Sipariş", lead: "CRM adayı", reminder: "Hatırlat", reply: "Yanıtla", task: "Yapılacak" };

export const MAIL_COLORS = ["#2563EB", "#DC2626", "#059669", "#D97706", "#7C3AED", "#DB2777", "#0891B2", "#4B5563"];
export const MAX_ATTACH = 10 * 1024 * 1024;

export const emailOf = (from: string) => (from.match(/<([^>]+)>/)?.[1] ?? from).trim().toLowerCase();
export const nameOf = (from: string) => (from.replace(/<[^>]+>/, "").replace(/"/g, "").trim() || emailOf(from));

/** HTML → düz metin (özet / yapay zekâ / alıntı için) */
export function htmlToText(html: string): string {
  return html
    .replace(/<(style|script|head)[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h\d|blockquote)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}
export const messageText = (m: Pick<Message, "html" | "text">) => (m.text?.trim() ? m.text : m.html ? htmlToText(m.html) : "");

export const fmtSize = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${Math.round(n / 1024)} KB` : `${(n / 1048576).toFixed(1)} MB`);

/** Yazma penceresinin başlangıcı (yeni / yanıt / tümüne yanıt / ilet) */
export type ComposeInit = {
  mode: "new" | "reply" | "replyAll" | "forward";
  to?: string; cc?: string; subject?: string; body?: string; quote?: string;
  threadId?: string; inReplyTo?: string; references?: string;
  fwdMsg?: string; fwdAtts?: Attachment[];
};

const escHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const fmtLong = (iso: string) => new Date(iso).toLocaleString("tr-TR", { timeZone: "Europe/Istanbul", dateStyle: "medium", timeStyle: "short" });
const prefix = (p: string, s: string) => (new RegExp(`^${p}:`, "i").test(s.trim()) ? s : `${p}: ${s}`);
const splitAddr = (v: string) => v.split(",").map((x) => x.trim()).filter(Boolean);

/** Bir iletiden yanıt / ilet taslağı */
export function composeFrom(mode: ComposeInit["mode"], m: Message, me: string, threadId: string, body = ""): ComposeInit {
  const bodyHtml = m.html ?? `<div>${escHtml(m.text).replace(/\n/g, "<br>")}</div>`;
  if (mode === "forward") {
    const head = `---------- İletilen ileti ----------<br>Kimden: ${escHtml(m.from)}<br>Tarih: ${fmtLong(m.date)}<br>Konu: ${escHtml(m.subject)}<br>Kime: ${escHtml(m.to)}<br><br>`;
    return { mode, subject: prefix("Fwd", m.subject), body, quote: `${head}${bodyHtml}`, fwdMsg: m.id, fwdAtts: m.attachments };
  }
  const from = emailOf(m.from) === me ? m.to : m.from;
  let to = from, cc = "";
  if (mode === "replyAll") {
    const seen = new Set([me, ...splitAddr(from).map(emailOf)]);
    const others = [...splitAddr(m.to), ...splitAddr(m.cc)].filter((x) => { const e = emailOf(x); if (seen.has(e)) return false; seen.add(e); return true; });
    to = from;
    cc = others.join(", ");
  }
  return {
    mode, to, cc, subject: prefix("Re", m.subject), body,
    quote: `<div>${fmtLong(m.date)} tarihinde ${escHtml(m.from)} şunu yazdı:</div><blockquote style="margin:0 0 0 .8ex;border-left:1px solid #ccc;padding-left:1ex">${bodyHtml}</blockquote>`,
    threadId, inReplyTo: m.messageId, references: m.references,
  };
}
