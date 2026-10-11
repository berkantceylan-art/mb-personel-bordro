"use server";
import Anthropic from "@anthropic-ai/sdk";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSession } from "@/lib/session";
import { aiModel } from "@/lib/ai-model";
import { aiOrderFromText, type AiResult } from "@/lib/ai-actions";
import { accessToken, getAttachment, getThread, GmailError, labelCounts, listLabels, listThreads, modifyThread, sendMail, trashThread, unseal } from "@/lib/gmail";
import { COUNTED, MAIL_COLORS, MAX_ATTACH, emailOf, messageText, nameOf, type AiAction, type Label, type MailAi, type ListAi, type MailLinkRow, type ThreadRow, type ThreadView } from "@/lib/mail";

type R<T> = { ok: true; data: T } | { ok: false; message: string };
const SQL = "Supabase'de 20270104000000_mail.sql çalıştırılmalı.";
const ID = /^[0-9a-f-]{36}$/i;
const TID = /^[0-9a-zA-Z_-]{6,64}$/;

async function run<T>(fn: () => Promise<T>): Promise<R<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (e) {
    if ((e as { digest?: string }).digest?.startsWith("NEXT_REDIRECT")) throw e;
    const m = (e as Error).message ?? "Hata";
    if (/mail_accounts|mail_ai|mail_links|schema cache/.test(m)) return { ok: false, message: SQL };
    if (e instanceof GmailError) {
      if (e.status === 429) return { ok: false, message: "Gmail kısa süreli sınır koydu; birkaç saniye sonra tekrar deneyin." };
      if (e.status === 403 && /insufficient/i.test(m)) return { ok: false, message: "Gmail izinleri eksik; hesabı yeniden bağlayın." };
      return { ok: false, message: e.message.slice(0, 200) };
    }
    return { ok: false, message: m.slice(0, 200) };
  }
}
async function tok(a: string) {
  if (!ID.test(a)) throw new GmailError("Hesap seçin.", 400);
  const s = await getSession();
  return { s, ...(await accessToken(a, s.userId)) };
}

// ---------------------------------------------------------------- okuma

export async function mailList(a: string, o: { folder: string; label?: string; q?: string; page?: string; meta?: boolean }): Promise<R<{ rows: ThreadRow[]; next: string | null; labels?: Label[]; counts?: Record<string, number>; ai: Record<string, ListAi> }>> {
  return run(async () => {
    const { token } = await tok(a);
    const label = o.label || (o.folder && o.folder !== "ALL" ? o.folder : undefined);
    const q = (o.q ?? "").slice(0, 300) || undefined;
    const [list, labels, counts] = await Promise.all([
      listThreads(token, { label: q && o.folder === "INBOX" && !o.label ? undefined : label, q, pageToken: o.page, max: 25 }),
      o.meta ? listLabels(token) : Promise.resolve(undefined),
      o.meta ? labelCounts(token, COUNTED) : Promise.resolve(undefined),
    ]);
    const supabase = await createClient();
    const { data: ai } = list.rows.length ? await supabase.from("mail_ai").select("thread_id, urgency, category, summary, done").eq("account_id", a).in("thread_id", list.rows.map((r) => r.id)) : { data: [] };
    return { ...list, labels, counts, ai: Object.fromEntries((ai ?? []).map((x) => [x.thread_id as string, { urgency: x.urgency as number | null, category: x.category as string | null, summary: x.summary as string | null, done: !!x.done }])) };
  });
}

export async function mailThread(a: string, id: string): Promise<R<ThreadView>> {
  return run(async () => {
    if (!TID.test(id)) throw new GmailError("Geçersiz konuşma.", 400);
    const { token, email } = await tok(a);
    const th = await getThread(token, id);
    if (th.messages.some((m) => m.unread)) await modifyThread(token, id, [], ["UNREAD"]).catch(() => null);
    const supabase = await createClient();
    const sender = [...th.messages].reverse().map((m) => emailOf(m.from)).find((e) => e && e !== email) ?? "";
    const [ai, links, cust] = await Promise.all([
      supabase.from("mail_ai").select("category, urgency, summary, actions, reply, done, history").eq("account_id", a).eq("thread_id", id).maybeSingle(),
      supabase.from("mail_links").select("id, entity, entity_id, note, created_at").eq("account_id", a).eq("thread_id", id).order("created_at"),
      sender ? supabase.from("lab_customers").select("id, name").ilike("email", sender).limit(1).maybeSingle() : Promise.resolve({ data: null }),
    ]);
    const labels = th.labels.filter((l) => l !== "UNREAD");
    return { id: th.id, subject: th.subject, messages: th.messages.map((m) => ({ ...m, unread: false })), labels, ai: (ai.data as MailAi | null) ?? null, links: (links.data ?? []) as MailLinkRow[], customer: (cust.data as { id: string; name: string } | null) ?? null };
  });
}

// ---------------------------------------------------------------- işlemler

const OPS: Record<string, [string[], string[]]> = {
  read: [[], ["UNREAD"]], unread: [["UNREAD"], []], star: [["STARRED"], []], unstar: [[], ["STARRED"]],
  archive: [[], ["INBOX"]], inbox: [["INBOX"], ["TRASH", "SPAM"]], spam: [["SPAM"], ["INBOX"]], notspam: [["INBOX"], ["SPAM"]],
  important: [["IMPORTANT"], []], unimportant: [[], ["IMPORTANT"]],
};
export async function mailModify(a: string, ids: string[], op: string, label?: string): Promise<R<number>> {
  return run(async () => {
    const { token } = await tok(a);
    const list = (Array.isArray(ids) ? ids : []).filter((x) => TID.test(x)).slice(0, 50);
    for (const id of list) {
      if (op === "trash") await trashThread(token, id);
      else if (op === "addLabel" && label) await modifyThread(token, id, [label.slice(0, 80)], []);
      else if (op === "removeLabel" && label) await modifyThread(token, id, [], [label.slice(0, 80)]);
      else if (OPS[op]) await modifyThread(token, id, OPS[op]![0], OPS[op]![1]);
      else throw new GmailError("Bilinmeyen işlem.", 400);
    }
    return list.length;
  });
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const ADDR = /^[^@\s,<>]+@[^@\s,<>]+\.[^@\s,<>]+$/;
const addrList = (v: FormDataEntryValue | null) => String(v ?? "").split(/[,;\n]/).map((x) => x.trim()).filter(Boolean).slice(0, 50);

/** Yeni ileti / yanıt / ilet (ekli). Gövde düz metin; alıntı HTML olarak eklenir */
export async function mailSend(f: FormData): Promise<R<{ id: string; threadId: string }>> {
  return run(async () => {
    const a = String(f.get("account") ?? "");
    const { token, email } = await tok(a);
    const to = addrList(f.get("to")), cc = addrList(f.get("cc")), bcc = addrList(f.get("bcc"));
    const bad = [...to, ...cc, ...bcc].find((x) => !ADDR.test(emailOf(x)));
    if (bad) throw new GmailError(`Geçersiz adres: ${bad}`, 400);
    if (!to.length && !cc.length && !bcc.length) throw new GmailError("Alıcı yazın.", 400);
    const subject = String(f.get("subject") ?? "").trim().slice(0, 250) || "(konu yok)";
    const body = String(f.get("body") ?? "").slice(0, 50000);
    const quote = String(f.get("quote") ?? "").slice(0, 200000);
    const supabase = await createClient();
    const { data: acc } = await supabase.from("mail_accounts").select("display_name, signature").eq("id", a).maybeSingle();
    const sig = f.get("nosig") ? "" : (acc?.signature ?? "").trim();
    const textAll = [body, sig ? `\n-- \n${sig}` : ""].join("");
    const html = `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5">${esc(body).replace(/\n/g, "<br>")}${sig ? `<br><br><div style="color:#555">-- <br>${esc(sig).replace(/\n/g, "<br>")}</div>` : ""}</div>${quote ? `<br><div class="gmail_quote">${quote}</div>` : ""}`;

    // Ekler: yüklenen dosyalar + iletilen iletinin ekleri
    const atts: { name: string; mime: string; data: Buffer }[] = [];
    let total = 0;
    for (const v of f.getAll("files")) {
      if (typeof v === "string" || !v.size) continue;
      total += v.size;
      if (total > MAX_ATTACH) throw new GmailError("Ekler toplam 10 MB'ı geçemez.", 400);
      atts.push({ name: v.name.slice(0, 180), mime: v.type || "application/octet-stream", data: Buffer.from(await v.arrayBuffer()) });
    }
    const fwdMsg = String(f.get("fwd_msg") ?? "");
    if (TID.test(fwdMsg)) {
      for (const raw of f.getAll("fwd_att").map(String).slice(0, 20)) {
        const [attId, size, mime, ...nm] = raw.split("|");
        total += Number(size) || 0;
        if (total > MAX_ATTACH) throw new GmailError("Ekler toplam 10 MB'ı geçemez (iletilen ekler dahil).", 400);
        atts.push({ name: nm.join("|").slice(0, 180) || "ek", mime: mime || "application/octet-stream", data: await getAttachment(token, fwdMsg, attId!) });
      }
    }
    const threadId = String(f.get("threadId") ?? "");
    const r = await sendMail(token, {
      from: email, fromName: acc?.display_name ?? undefined, to: to.join(", "), cc: cc.join(", "), bcc: bcc.join(", "), subject, html, text: textAll,
      threadId: TID.test(threadId) ? threadId : undefined,
      inReplyTo: String(f.get("inReplyTo") ?? "").slice(0, 500) || undefined,
      references: String(f.get("references") ?? "").slice(0, 4000) || undefined,
      attachments: atts,
    });
    return r;
  });
}

// ---------------------------------------------------------------- hesaplar

export async function mailAccountSave(f: FormData): Promise<R<true>> {
  return run(async () => {
    const id = String(f.get("id") ?? "");
    if (!ID.test(id)) throw new Error("Hesap seçin.");
    const color = String(f.get("color") ?? "");
    const supabase = await createClient();
    const { error } = await supabase.from("mail_accounts").update({
      display_name: String(f.get("display_name") ?? "").trim().slice(0, 120) || null,
      signature: String(f.get("signature") ?? "").trim().slice(0, 2000) || null,
      ...(MAIL_COLORS.includes(color) ? { color } : {}),
      updated_at: new Date().toISOString(),
    }).eq("id", id);
    if (error) throw new Error(error.message);
    revalidatePath("/posta");
    return true as const;
  });
}

/** Hesabın bağlantısını kaldır: Google erişimi geri alınır, kayıt silinir */
export async function mailDisconnect(id: string): Promise<R<true>> {
  return run(async () => {
    const s = await getSession();
    if (!ID.test(id)) throw new Error("Hesap seçin.");
    const admin = createAdminClient();
    const { data } = await admin.from("mail_accounts").select("user_id, refresh_token_enc").eq("id", id).maybeSingle();
    if (!data || data.user_id !== s.userId) throw new Error("Hesap bulunamadı.");
    if (data.refresh_token_enc) {
      try { await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(unseal(data.refresh_token_enc))}`, { method: "POST", cache: "no-store" }); } catch { /* yok say */ }
    }
    const supabase = await createClient();
    const { error } = await supabase.from("mail_accounts").delete().eq("id", id);
    if (error) throw new Error(error.message);
    revalidatePath("/posta");
    return true as const;
  });
}

// ---------------------------------------------------------------- ERP'ye aktar

export async function mailCustomers(q: string): Promise<{ id: string; name: string }[]> {
  const t = String(q ?? "").trim().slice(0, 60);
  if (t.length < 2) return [];
  const supabase = await createClient();
  const { data } = await supabase.from("lab_customers").select("id, name").eq("is_active", true).ilike("name", `%${t.replace(/[%_,()]/g, " ")}%`).order("name").limit(12);
  return (data ?? []) as { id: string; name: string }[];
}

async function link(a: string, threadId: string, entity: string, entityId: string | null, meta: { subject?: string; sender?: string; note?: string }) {
  const supabase = await createClient();
  const { error } = await supabase.from("mail_links").insert({ account_id: a, thread_id: threadId, entity, entity_id: entityId, subject: meta.subject?.slice(0, 300) ?? null, sender: meta.sender?.slice(0, 300) ?? null, note: meta.note?.slice(0, 300) ?? null });
  if (error) throw new Error(error.message);
}

export async function mailLinkCustomer(a: string, threadId: string, customerId: string, meta: { subject?: string; sender?: string }): Promise<R<true>> {
  return run(async () => {
    if (!ID.test(a) || !TID.test(threadId) || !ID.test(customerId)) throw new Error("Eksik bilgi.");
    const supabase = await createClient();
    const { data: c } = await supabase.from("lab_customers").select("name").eq("id", customerId).maybeSingle();
    await link(a, threadId, "customer", customerId, { ...meta, note: c?.name ?? "" });
    return true as const;
  });
}

export async function mailUnlink(id: string): Promise<R<true>> {
  return run(async () => {
    const supabase = await createClient();
    const { error } = await supabase.from("mail_links").delete().eq("id", id);
    if (error) throw new Error(error.message);
    return true as const;
  });
}

/** Gönderenden CRM adayı oluştur */
export async function mailToLead(a: string, threadId: string): Promise<R<string>> {
  return run(async () => {
    const { token, email } = await tok(a);
    const th = await getThread(token, threadId);
    const m = th.messages.find((x) => emailOf(x.from) !== email) ?? th.messages[0];
    if (!m) throw new Error("İleti bulunamadı.");
    const from = emailOf(m.from), who = nameOf(m.from);
    const supabase = await createClient();
    const { data: old } = await supabase.from("crm_leads").select("id").ilike("email", from).limit(1).maybeSingle();
    if (old) { await link(a, threadId, "lead", old.id as string, { subject: th.subject, sender: m.from, note: who }); return old.id as string; }
    const today = new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 10);
    const domain = from.split("@")[1] ?? "";
    const free = /^(gmail|hotmail|outlook|yahoo|yandex|icloud|live|msn)\./i.test(domain);
    const { data, error } = await supabase.from("crm_leads").insert({
      name: (free ? who : domain.split(".")[0]!.replace(/^./, (c) => c.toLocaleUpperCase("tr"))).slice(0, 160) || who.slice(0, 160),
      contact_name: who.slice(0, 120), email: from.slice(0, 200), source: "other", stage: "new",
      next_action: "E-postayı yanıtla", next_date: today,
      note: `E-posta: ${th.subject}\n${messageText(m).slice(0, 1500)}`.slice(0, 2000),
    }).select("id").single();
    if (error) throw new Error(/row-level|policy/.test(error.message) ? "CRM'e kayıt yetkiniz yok." : error.message);
    await link(a, threadId, "lead", data.id as string, { subject: th.subject, sender: m.from, note: who });
    revalidatePath("/crm");
    return data.id as string;
  });
}

/** E-postadan sipariş taslağı (yapay zekâ): siparişler kutusuna düşer ve düzenleme ekranı açılır */
export async function mailToOrder(a: string, threadId: string): Promise<AiResult> {
  const r = await run(async () => {
    const { token, email } = await tok(a);
    const th = await getThread(token, threadId);
    const parts = th.messages.filter((m) => emailOf(m.from) !== email).slice(-3).map((m) => `Kimden: ${m.from}\n${messageText(m).slice(0, 2500)}`);
    return `Konu: ${th.subject}\n${parts.join("\n---\n")}`.slice(0, 4000);
  });
  if (!r.ok) return { ok: false, message: r.message };
  const fd = new FormData();
  fd.set("text", r.data);
  fd.set("source", "email");
  return aiOrderFromText(null, fd);
}

/** Bu e-posta için hatırlatma kur (masaüstü hatırlatmalarına düşer) */
export async function mailRemind(a: string, threadId: string, title: string, at: string, note?: string): Promise<R<true>> {
  return run(async () => {
    if (!ID.test(a) || !TID.test(threadId)) throw new Error("Eksik bilgi.");
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(at)) throw new Error("Tarih ve saat seçin.");
    const t = String(title ?? "").trim().slice(0, 160) || "E-postaya dön";
    const supabase = await createClient();
    const { data, error } = await supabase.from("user_reminders").insert({
      title: `📧 ${t}`.slice(0, 160), note: String(note ?? "").slice(0, 1000) || null, remind_at: new Date(`${at}:00+03:00`).toISOString(), repeat: "none",
      link: `/posta?a=${a}&t=${threadId}`,
    }).select("id").single();
    if (error) throw new Error(/user_reminders/.test(error.message) ? "Supabase'de 20270103000000_desktop.sql çalıştırılmalı." : error.message);
    await link(a, threadId, "reminder", data.id as string, { subject: t, note: at.replace("T", " ") });
    revalidatePath("/");
    return true as const;
  });
}

// ---------------------------------------------------------------- yapay zekâ

const json = <T,>(text: string, open = "{", close = "}"): T => JSON.parse(text.slice(text.indexOf(open), text.lastIndexOf(close) + 1)) as T;
const CATS = ["case", "question", "complaint", "price", "invoice", "order", "info", "spam", "other"];
const KINDS = ["order", "lead", "reminder", "reply", "task"];
type RawAi = { category?: string; urgency?: number; summary?: string; actions?: AiAction[]; reply?: string };
const clean = (d: RawAi) => ({
  category: CATS.includes(d.category ?? "") ? d.category! : "other",
  urgency: Math.max(0, Math.min(3, Math.round(Number(d.urgency) || 0))),
  summary: String(d.summary ?? "").slice(0, 1200) || null,
  actions: (Array.isArray(d.actions) ? d.actions : []).filter((x) => x && KINDS.includes(x.kind)).slice(0, 6).map((x) => ({ kind: x.kind, text: String(x.text ?? "").slice(0, 200), due: /^\d{4}-\d{2}-\d{2}$/.test(String(x.due ?? "")) ? x.due : null })),
  reply: String(d.reply ?? "").slice(0, 4000) || null,
});
const AI_RULES = `Sen bir diş protez laboratuvarının (MB Dental) e-posta asistanısın. Kategori: case (vaka/iş), question, complaint, price, invoice, order, info, spam, other. Aciliyet 0-3 (3 = bugün dönülmeli). Özet Türkçe, en fazla 3 kısa cümle; kim, ne istiyor, tarih/tutar varsa yaz. Yapılacaklar: kind ∈ order (sipariş/vaka oluştur), lead (yeni potansiyel müşteri), reminder (tarihli takip), reply (yanıt gerekli), task (diğer iş); text kısa Türkçe emir cümlesi; due YYYY-MM-DD ya da null.`;

export async function mailAi(a: string, threadId: string, force = false): Promise<R<MailAi>> {
  return run(async () => {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) throw new Error("Yapay zekâ için Vercel'e ANTHROPIC_API_KEY eklenmeli.");
    const { token, email } = await tok(a);
    const th = await getThread(token, threadId);
    const last = th.messages[th.messages.length - 1];
    const supabase = await createClient();
    if (!force) {
      const { data } = await supabase.from("mail_ai").select("category, urgency, summary, actions, reply, done, history").eq("account_id", a).eq("thread_id", threadId).maybeSingle();
      if (data && data.history === last?.id) return data as MailAi;
    }
    const today = new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 10);
    const conv = th.messages.slice(-6).map((m) => `[${m.date.slice(0, 16).replace("T", " ")}] ${emailOf(m.from) === email ? "BEN" : m.from}:\n${messageText(m).slice(0, 2500)}`).join("\n\n---\n\n").slice(0, 12000);
    const res = await new Anthropic({ apiKey: key }).messages.create({
      model: aiModel(), max_tokens: 1400,
      messages: [{ role: "user", content: `${AI_RULES}\nBugün ${today}. Benim adresim ${email}. Yalnız JSON döndür:\n{"category":"…","urgency":0,"summary":"…","actions":[{"kind":"reply","text":"…","due":null}],"reply":"gönderenin dilinde, kibar, kısa yanıt taslağı (imzasız); yanıt gerekmiyorsa boş"}\nKonu: ${th.subject}\n"""\n${conv}\n"""` }],
    });
    const out = res.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("");
    const row = { ...clean(json<RawAi>(out)), done: false, history: last?.id ?? null };
    const { error } = await supabase.from("mail_ai").upsert({ account_id: a, thread_id: threadId, ...row, created_at: new Date().toISOString() }, { onConflict: "account_id,thread_id" });
    if (error) throw new Error(error.message);
    revalidatePath("/");
    return row as MailAi;
  });
}

/** Gelen kutusundaki okunmamışları tek seferde özetle (masaüstündeki “Bugün senin için” bundan beslenir) */
export async function mailTriage(a: string): Promise<R<number>> {
  return run(async () => {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) throw new Error("Yapay zekâ için Vercel'e ANTHROPIC_API_KEY eklenmeli.");
    const { token, email } = await tok(a);
    const { rows } = await listThreads(token, { label: "INBOX", q: "is:unread newer_than:7d", max: 10 });
    if (!rows.length) return 0;
    const supabase = await createClient();
    const { data: done } = await supabase.from("mail_ai").select("thread_id").eq("account_id", a).in("thread_id", rows.map((r) => r.id));
    const have = new Set((done ?? []).map((d) => d.thread_id as string));
    const todo = rows.filter((r) => !have.has(r.id)).slice(0, 8);
    if (!todo.length) return 0;
    const bodies = await Promise.all(todo.map(async (r) => {
      const th = await getThread(token, r.id);
      const m = [...th.messages].reverse().find((x) => emailOf(x.from) !== email) ?? th.messages[th.messages.length - 1];
      return { id: r.id, last: th.messages[th.messages.length - 1]?.id ?? null, text: `#${r.id}\nKonu: ${th.subject}\nKimden: ${m?.from ?? ""}\n${m ? messageText(m).slice(0, 1500) : r.snippet}` };
    }));
    const today = new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 10);
    const res = await new Anthropic({ apiKey: key }).messages.create({
      model: aiModel(), max_tokens: 3000,
      messages: [{ role: "user", content: `${AI_RULES}\nBugün ${today}. Aşağıdaki e-postaların her biri için bir nesne içeren yalnız JSON dizi döndür (yanıt taslağı yazma):\n[{"id":"#sonrasındaki kimlik","category":"…","urgency":0,"summary":"…","actions":[…]}]\n\n${bodies.map((b) => b.text).join("\n\n=====\n\n")}` }],
    });
    const out = res.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("");
    const arr = json<(RawAi & { id?: string })[]>(out, "[", "]");
    const now = new Date().toISOString();
    const up = arr.filter((x) => bodies.some((b) => b.id === String(x.id ?? "").replace(/^#/, ""))).map((x) => {
      const id = String(x.id).replace(/^#/, "");
      return { account_id: a, thread_id: id, ...clean({ ...x, reply: "" }), done: false, history: bodies.find((b) => b.id === id)?.last ?? null, created_at: now };
    });
    if (up.length) {
      const { error } = await supabase.from("mail_ai").upsert(up, { onConflict: "account_id,thread_id" });
      if (error) throw new Error(error.message);
    }
    revalidatePath("/");
    return up.length;
  });
}

export async function mailAiDone(a: string, threadId: string, done: boolean): Promise<R<true>> {
  return run(async () => {
    const supabase = await createClient();
    const { error } = await supabase.from("mail_ai").update({ done }).eq("account_id", a).eq("thread_id", threadId);
    if (error) throw new Error(error.message);
    revalidatePath("/");
    return true as const;
  });
}
