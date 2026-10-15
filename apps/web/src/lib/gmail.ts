import "server-only";
import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Gmail istemcisi (yalnız sunucu). Google yenileme anahtarı AES-256-GCM ile şifrelenip saklanır;
 * şifreleme anahtarı SUPABASE_SERVICE_ROLE_KEY'den türetilir (ayrı gizli anahtar gerekmez).
 */
export const GMAIL_SCOPES = [
  "openid", "email", "profile",
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/gmail.send",
];
export const gmailConfigured = () => !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.SUPABASE_SERVICE_ROLE_KEY);
export const redirectUri = (origin: string) => `${process.env.NEXT_PUBLIC_ERP_URL || origin}/api/gmail/callback`;

const key = () => createHmac("sha256", process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").update("mb-gmail-token-v1").digest();
export function seal(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return `v1.${iv.toString("base64url")}.${c.getAuthTag().toString("base64url")}.${enc.toString("base64url")}`;
}
export function unseal(sealed: string): string {
  const [v, iv, tag, data] = sealed.split(".");
  if (v !== "v1" || !iv || !tag || !data) throw new Error("bad_token");
  const d = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([d.update(Buffer.from(data, "base64url")), d.final()]).toString("utf8");
}
/** OAuth "state" imzası (CSRF koruması) */
export function signState(payload: string): string {
  return `${payload}.${createHmac("sha256", key()).update(`state:${payload}`).digest("base64url").slice(0, 32)}`;
}
export function verifyState(state: string): string | null {
  const i = state.lastIndexOf(".");
  if (i < 0) return null;
  const payload = state.slice(0, i);
  return signState(payload) === state ? payload : null;
}

export class GmailError extends Error {
  constructor(message: string, public status = 500) { super(message); }
}

/** Hesabın geçerli erişim anahtarı (gerekirse yeniler). userId: hesabın sahibi olduğu doğrulanır */
export async function accessToken(accountId: string, userId: string): Promise<{ token: string; email: string }> {
  const admin = createAdminClient();
  const { data: a } = await admin.from("mail_accounts").select("id, user_id, email, refresh_token_enc, access_token_enc, access_expires_at, status").eq("id", accountId).maybeSingle();
  if (!a || a.user_id !== userId) throw new GmailError("Hesap bulunamadı.", 404);
  if (a.access_token_enc && a.access_expires_at && Date.parse(a.access_expires_at) > Date.now() + 60_000) {
    try { return { token: unseal(a.access_token_enc), email: a.email }; } catch { /* yenile */ }
  }
  if (!a.refresh_token_enc) throw new GmailError("Hesabın bağlantısı yenilenmeli (yeniden bağlayın).", 401);
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID!, client_secret: process.env.GOOGLE_CLIENT_SECRET!, refresh_token: unseal(a.refresh_token_enc), grant_type: "refresh_token" }),
    cache: "no-store",
  });
  const j = (await res.json()) as { access_token?: string; expires_in?: number; error?: string; error_description?: string };
  if (!res.ok || !j.access_token) {
    const revoked = j.error === "invalid_grant";
    await admin.from("mail_accounts").update({ status: revoked ? "revoked" : "error", last_error: (j.error_description ?? j.error ?? "").slice(0, 300) }).eq("id", accountId);
    throw new GmailError(revoked ? "Google erişimi geri alınmış; hesabı yeniden bağlayın." : "Google'a bağlanılamadı.", 401);
  }
  await admin.from("mail_accounts").update({ access_token_enc: seal(j.access_token), access_expires_at: new Date(Date.now() + (j.expires_in ?? 3600) * 1000).toISOString(), status: "active", last_error: null }).eq("id", accountId);
  return { token: j.access_token, email: a.email };
}

async function api<T>(token: string, path: string, init?: RequestInit, attempt = 0): Promise<T> {
  const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, ...(init?.body ? { "content-type": "application/json" } : {}), ...(init?.headers ?? {}) },
    cache: "no-store",
  });
  if (!res.ok) {
    const t = await res.text();
    // kota / hız sınırı: kısa bekleyip en çok iki kez yeniden dene
    if ((res.status === 429 || (res.status === 403 && /rateLimit|Quota exceeded|userRateLimitExceeded/i.test(t))) && attempt < 2) {
      await new Promise((r) => setTimeout(r, attempt === 0 ? 3000 : 12000));
      return api<T>(token, path, init, attempt + 1);
    }
    throw new GmailError(`Gmail: ${res.status} ${t.slice(0, 200)}`, res.status);
  }
  return (res.status === 204 ? {} : await res.json()) as T;
}

type Header = { name: string; value: string };
type Part = { partId?: string; mimeType: string; filename?: string; headers?: Header[]; body?: { size: number; data?: string; attachmentId?: string }; parts?: Part[] };
type RawMsg = { id: string; threadId: string; labelIds?: string[]; snippet?: string; internalDate?: string; payload?: Part };
export type MailThreadRow = { id: string; subject: string; from: string; fromEmail: string; snippet: string; date: string; unread: boolean; starred: boolean; count: number; hasAttachment: boolean; labels: string[] };
export type MailMessage = { id: string; from: string; to: string; cc: string; date: string; subject: string; html: string | null; text: string; attachments: { id: string; name: string; mime: string; size: number }[]; messageId: string; references: string; unread: boolean };
export type MailLabel = { id: string; name: string; type: string; unread?: number };

const hdr = (h: Header[] | undefined, n: string) => h?.find((x) => x.name.toLowerCase() === n.toLowerCase())?.value ?? "";
const b64 = (s: string) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
export const emailOf = (from: string) => (from.match(/<([^>]+)>/)?.[1] ?? from).trim().toLowerCase();
export const nameOf = (from: string) => (from.replace(/<[^>]+>/, "").replace(/"/g, "").trim() || emailOf(from));

function walk(p: Part | undefined, out: { html: string | null; text: string; atts: MailMessage["attachments"] }) {
  if (!p) return;
  if (p.filename && p.body?.attachmentId) out.atts.push({ id: p.body.attachmentId, name: p.filename, mime: p.mimeType, size: p.body.size });
  else if (p.mimeType === "text/html" && p.body?.data && out.html == null) out.html = b64(p.body.data);
  else if (p.mimeType === "text/plain" && p.body?.data && !out.text) out.text = b64(p.body.data);
  p.parts?.forEach((c) => walk(c, out));
}

export async function listLabels(token: string): Promise<MailLabel[]> {
  const r = await api<{ labels?: MailLabel[] }>(token, "labels");
  return (r.labels ?? []).filter((l) => l.type === "user").sort((a, b) => a.name.localeCompare(b.name, "tr"));
}

export async function listThreads(token: string, opts: { label?: string; q?: string; pageToken?: string; max?: number }): Promise<{ rows: MailThreadRow[]; next: string | null }> {
  const p = new URLSearchParams({ maxResults: String(opts.max ?? 30) });
  if (opts.label) p.append("labelIds", opts.label);
  if (opts.q) p.set("q", opts.q);
  if (opts.pageToken) p.set("pageToken", opts.pageToken);
  if (opts.label === "SPAM" || opts.label === "TRASH") p.set("includeSpamTrash", "true");
  const r = await api<{ threads?: { id: string }[]; nextPageToken?: string }>(token, `threads?${p}`);
  const rows = await pool((r.threads ?? []), 6, async (t) => {
    const th = await api<{ id: string; messages?: RawMsg[] }>(token, `threads/${t.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`);
    const msgs = th.messages ?? [];
    const first = msgs[0];
    const last = msgs[msgs.length - 1];
    const labels = [...new Set(msgs.flatMap((m) => m.labelIds ?? []))];
    const fromMsg = [...msgs].reverse().find((m) => !(m.labelIds ?? []).includes("SENT")) ?? last;
    return {
      id: th.id,
      subject: hdr(first?.payload?.headers, "Subject") || "(konu yok)",
      from: nameOf(hdr(fromMsg?.payload?.headers, "From")),
      fromEmail: emailOf(hdr(fromMsg?.payload?.headers, "From")),
      snippet: (last?.snippet ?? "").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&"),
      date: new Date(Number(last?.internalDate ?? 0)).toISOString(),
      unread: labels.includes("UNREAD"),
      starred: labels.includes("STARRED"),
      count: msgs.length,
      hasAttachment: msgs.some((m) => JSON.stringify(m.payload ?? {}).includes('"attachmentId"')),
      labels,
    };
  });
  return { rows, next: r.nextPageToken ?? null };
}

/** Sınırlı eşzamanlılık (Gmail kota sınırı için) */
async function pool<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k]!); }
  }));
  return out;
}

/** Klasör sayaçları (okunmamış konuşma) */
export async function labelCounts(token: string, ids: string[]): Promise<Record<string, number>> {
  const r = await pool(ids, 4, async (id) => {
    try { const l = await api<{ id: string; threadsUnread?: number; threadsTotal?: number }>(token, `labels/${id}`); return [id, id === "DRAFT" ? (l.threadsTotal ?? 0) : (l.threadsUnread ?? 0)] as const; } catch { return [id, 0] as const; }
  });
  return Object.fromEntries(r);
}

export async function getThread(token: string, id: string): Promise<{ id: string; subject: string; messages: MailMessage[]; labels: string[] }> {
  const th = await api<{ id: string; messages?: RawMsg[] }>(token, `threads/${encodeURIComponent(id)}?format=full`);
  const messages = (th.messages ?? []).map((m) => {
    const out = { html: null as string | null, text: "", atts: [] as MailMessage["attachments"] };
    walk(m.payload, out);
    const h = m.payload?.headers;
    return {
      id: m.id, from: hdr(h, "From"), to: hdr(h, "To"), cc: hdr(h, "Cc"), subject: hdr(h, "Subject"),
      date: new Date(Number(m.internalDate ?? 0)).toISOString(), html: out.html, text: out.text, attachments: out.atts,
      messageId: hdr(h, "Message-ID") || hdr(h, "Message-Id"), references: hdr(h, "References"), unread: (m.labelIds ?? []).includes("UNREAD"),
    };
  });
  return { id: th.id, subject: messages[0]?.subject || "(konu yok)", messages, labels: [...new Set((th.messages ?? []).flatMap((m) => m.labelIds ?? []))] };
}

/** Sorguya uyan e-posta kimlikleri (hafif: yalnız liste) */
export async function listMessageIds(token: string, opts: { q: string; pageToken?: string; max?: number }): Promise<{ ids: string[]; next: string | null }> {
  const p = new URLSearchParams({ maxResults: String(opts.max ?? 50), q: opts.q });
  if (opts.pageToken) p.set("pageToken", opts.pageToken);
  const r = await api<{ messages?: { id: string }[]; nextPageToken?: string }>(token, `messages?${p}`);
  return { ids: (r.messages ?? []).map((m) => m.id), next: r.nextPageToken ?? null };
}

/** Tek e-posta: başlık ve ek listesi (gövde çözülmez) */
export async function getMessageAttachments(token: string, id: string): Promise<{ id: string; subject: string; attachments: MailMessage["attachments"] }> {
  const m = await api<RawMsg>(token, `messages/${encodeURIComponent(id)}?format=full`);
  const out = { html: null as string | null, text: "", atts: [] as MailMessage["attachments"] };
  walk(m.payload, out);
  return { id: m.id, subject: hdr(m.payload?.headers, "Subject"), attachments: out.atts };
}

export const isQuotaError = (e: unknown) => e instanceof GmailError && (e.status === 429 || (e.status === 403 && /quota|rate/i.test(e.message)));

export async function modifyThread(token: string, id: string, add: string[], remove: string[]) {
  await api(token, `threads/${encodeURIComponent(id)}/modify`, { method: "POST", body: JSON.stringify({ addLabelIds: add, removeLabelIds: remove }) });
}
export async function trashThread(token: string, id: string) {
  await api(token, `threads/${encodeURIComponent(id)}/trash`, { method: "POST" });
}
export async function getAttachment(token: string, msgId: string, attId: string): Promise<Buffer> {
  const r = await api<{ data: string }>(token, `messages/${encodeURIComponent(msgId)}/attachments/${encodeURIComponent(attId)}`);
  return Buffer.from(r.data.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

const encHeader = (s: string) => (/^[\x20-\x7E]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, "utf8").toString("base64")}?=`);
const encAddr = (s: string) => s.split(",").map((a) => a.trim()).filter(Boolean).map((a) => {
  const m = a.match(/^(.*)<([^>]+)>$/);
  return m && m[1]!.trim() ? `${encHeader(m[1]!.trim().replace(/"/g, ""))} <${m[2]}>` : a;
}).join(", ");

/** RFC 2822 ileti oluşturup gönderir; yanıtsa aynı konuşmaya (threadId) eklenir */
export async function sendMail(token: string, m: { from: string; fromName?: string; to: string; cc?: string; bcc?: string; subject: string; html: string; text: string; threadId?: string; inReplyTo?: string; references?: string; attachments?: { name: string; mime: string; data: Buffer }[] }) {
  const boundary = `mb_${randomBytes(12).toString("hex")}`;
  const alt = `alt_${randomBytes(8).toString("hex")}`;
  const lines = [
    `From: ${m.fromName ? `${encHeader(m.fromName)} <${m.from}>` : m.from}`,
    `To: ${encAddr(m.to)}`,
    ...(m.cc ? [`Cc: ${encAddr(m.cc)}`] : []),
    ...(m.bcc ? [`Bcc: ${encAddr(m.bcc)}`] : []),
    `Subject: ${encHeader(m.subject)}`,
    ...(m.inReplyTo ? [`In-Reply-To: ${m.inReplyTo}`, `References: ${[m.references, m.inReplyTo].filter(Boolean).join(" ")}`] : []),
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    `Content-Type: multipart/alternative; boundary="${alt}"`,
    "",
    `--${alt}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(m.text, "utf8").toString("base64").replace(/.{76}/g, "$&\r\n"),
    `--${alt}`,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(m.html, "utf8").toString("base64").replace(/.{76}/g, "$&\r\n"),
    `--${alt}--`,
    ...(m.attachments ?? []).flatMap((a) => [
      `--${boundary}`,
      `Content-Type: ${a.mime || "application/octet-stream"}; name="${encHeader(a.name)}"`,
      `Content-Disposition: attachment; filename="${encHeader(a.name)}"`,
      "Content-Transfer-Encoding: base64",
      "",
      a.data.toString("base64").replace(/.{76}/g, "$&\r\n"),
    ]),
    `--${boundary}--`,
    "",
  ];
  const raw = Buffer.from(lines.join("\r\n"), "utf8").toString("base64url");
  return api<{ id: string; threadId: string }>(token, "messages/send", { method: "POST", body: JSON.stringify({ raw, ...(m.threadId ? { threadId: m.threadId } : {}) }) });
}
