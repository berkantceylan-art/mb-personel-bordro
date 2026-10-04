"use server";

import { createHash } from "node:crypto";
import { headers } from "next/headers";
import { hasSupabase } from "./cms";
import { isLocale } from "./i18n";
import { createClient } from "./supabase/server";

export type ContactValues = Partial<Record<"topic" | "name" | "email" | "phone" | "company" | "country" | "message", string>>;
export type ContactState = { ok?: boolean; error?: "required" | "email" | "rate" | "spam" | "server"; at?: number; values?: ContactValues };

const TOPICS = ["general", "case", "price", "partner"];
const s = (f: FormData, k: string, max: number) => String(f.get(k) ?? "").trim().slice(0, max);

/** Sitedeki iletişim / vaka formu → gelen kutusu */
export async function sendMessage(prev: ContactState, form: FormData): Promise<ContactState> {
  const res = await send(form);
  if (res.ok) return res;
  // Hata olursa yazılanlar kaybolmasın
  const values: ContactValues = {};
  for (const k of ["topic", "name", "email", "phone", "company", "country", "message"] as const) values[k] = s(form, k, 5000);
  return { ...res, values };
}

async function send(form: FormData): Promise<ContactState> {
  // Bot tuzakları: görünmez alan dolu ya da form 3 saniyeden kısa sürede gönderildi
  if (s(form, "website", 200)) return { ok: true, at: Date.now() };
  const started = Number(s(form, "t", 20));
  if (!started || Date.now() - started < 3000) return { error: "spam", at: Date.now() };

  const name = s(form, "name", 120);
  const email = s(form, "email", 200);
  const message = s(form, "message", 5000);
  if (!name || !email || !message) return { error: "required", at: Date.now() };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error: "email", at: Date.now() };
  if (!hasSupabase()) return { error: "server", at: Date.now() };

  const topic = TOPICS.includes(s(form, "topic", 20)) ? s(form, "topic", 20) : "general";
  const locale = s(form, "locale", 2);
  const meta: Record<string, string> = {};
  const tooth = s(form, "tooth", 2);
  if (/^[1-4][1-8]$/.test(tooth)) meta.tooth = tooth;
  const product = s(form, "product", 60);
  if (/^[a-z0-9-]{1,60}$/.test(product)) meta.product = product;

  const h = await headers();
  const ip = (h.get("x-forwarded-for") ?? h.get("x-real-ip") ?? "").split(",")[0].trim();
  // Kişisel veri saklamamak için IP'nin günlük tuzlu özeti (yalnız hız sınırı için)
  const day = new Date().toISOString().slice(0, 10);
  const ipHash = ip ? createHash("sha256").update(`mbdental:${day}:${ip}`).digest("hex").slice(0, 32) : null;

  try {
    const supabase = await createClient();
    const { error } = await supabase.rpc("submit_site_message", {
      p_topic: topic,
      p_name: name,
      p_email: email,
      p_phone: s(form, "phone", 40) || null,
      p_company: s(form, "company", 160) || null,
      p_country: s(form, "country", 80) || null,
      p_message: message,
      p_meta: meta,
      p_locale: isLocale(locale) ? locale : null,
      p_page: s(form, "page", 300) || null,
      p_ip_hash: ipHash,
    });
    if (error) return { error: error.message.includes("rate_limited") ? "rate" : "server", at: Date.now() };
  } catch {
    return { error: "server", at: Date.now() };
  }
  return { ok: true, at: Date.now() };
}
