import "server-only";
/**
 * SGK SOAP istemcisi. Servis tanımı (WSDL) çalışma anında SGK'dan okunur; metod ve alan adları
 * eş anlamlı ad tablosuyla eşleştirilir. Böylece SGK'nın alan adlarındaki küçük farklılıklar (büyük/küçük harf,
 * Türkçe karakter, ön ek) gönderimi bozmaz; eşleşmeyen alanlar işlem günlüğüne yazılır.
 */
import * as soap from "soap";
import { createAdminClient } from "@/lib/supabase/admin";
import { DEFAULT_URLS } from "./codes";
import { decrypt } from "./crypto";

export type Account = { id: string; company_id: string; isyeri_sicil: string; kullanici_adi: string; isyeri_kodu: string; environment: "test" | "canli"; sistem: string | null; isyeri: string | null; ws: string | null; giris_wsdl: string; cikis_wsdl: string; vizite_url: string };

/** Hesabı ve çözülmüş şifreleri yalnız sunucuda yükler */
export async function loadAccount(companyId: string): Promise<Account | null> {
  const admin = createAdminClient();
  const { data } = await admin.from("sgk_accounts").select("*").eq("company_id", companyId).order("updated_at", { ascending: false }).limit(1).maybeSingle();
  if (!data) return null;
  const env = (data.environment === "canli" ? "canli" : "test") as "test" | "canli";
  const def = DEFAULT_URLS[env];
  return {
    id: data.id, company_id: data.company_id, isyeri_sicil: data.isyeri_sicil, kullanici_adi: data.kullanici_adi, isyeri_kodu: data.isyeri_kodu, environment: env,
    sistem: decrypt(data.sistem_sifre_enc), isyeri: decrypt(data.isyeri_sifre_enc), ws: decrypt(data.ws_sifre_enc),
    giris_wsdl: data.giris_wsdl || def.giris, cikis_wsdl: data.cikis_wsdl || def.cikis, vizite_url: data.vizite_url || def.vizite,
  };
}

const cache = new Map<string, Promise<soap.Client>>();
export function client(wsdl: string) {
  const url = /\?wsdl$/i.test(wsdl) ? wsdl : `${wsdl}?wsdl`;
  if (!cache.has(url)) {
    const p = soap.createClientAsync(url, { wsdl_options: { timeout: 20000 }, disableCache: false });
    p.catch(() => cache.delete(url));
    cache.set(url, p);
  }
  return cache.get(url)!;
}

/** Türkçe karakter ve ön ekleri kaldırıp küçük harfe çevirir */
export const norm = (s: string) => s.replace(/^[a-z0-9]+:/i, "").replace(/\[\]$/, "").toLocaleLowerCase("tr").replace(/ı/g, "i").replace(/ğ/g, "g").replace(/ü/g, "u").replace(/ş/g, "s").replace(/ö/g, "o").replace(/ç/g, "c").replace(/[^a-z0-9]/g, "");

type Schema = Record<string, unknown>;
export function operations(c: soap.Client) {
  const d = c.describe() as Record<string, Record<string, Record<string, { input: Schema; output: Schema }>>>;
  const ops: Array<{ name: string; input: Schema; output: Schema }> = [];
  for (const svc of Object.values(d)) for (const port of Object.values(svc)) for (const [name, op] of Object.entries(port)) ops.push({ name, input: op.input, output: op.output });
  return ops;
}
export function findOp(c: soap.Client, candidates: string[]) {
  const ops = operations(c);
  for (const cand of candidates) { const n = norm(cand); const hit = ops.find((o) => norm(o.name) === n); if (hit) return hit; }
  for (const cand of candidates) { const n = norm(cand); const hit = ops.find((o) => norm(o.name).includes(n)); if (hit) return hit; }
  return null;
}

/**
 * Şemaya göre gövde oluşturur. ctx: düz değer sözlüğü (normalize anahtar → değer); lists: dizi alanları için satırlar;
 * scopes: iç içe nesneler için ad parçasına göre ek sözlük (ör. "oncekidonem" → önceki dönem değerleri).
 */
export function build(schema: Schema, ctx: Record<string, unknown>, opts: { list?: Array<Record<string, unknown>>; scopes?: Record<string, Record<string, unknown> | null>; dateFmt?: "iso" | "tr" } = {}, missing: string[] = [], path = ""): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [rawKey, type] of Object.entries(schema)) {
    if (rawKey === "targetNSAlias" || rawKey === "targetNamespace") continue;
    const isList = rawKey.endsWith("[]");
    const key = rawKey.replace(/\[\]$/, "");
    const n = norm(key);
    if (type && typeof type === "object") {
      const scope = Object.entries(opts.scopes ?? {}).find(([k]) => n.includes(k));
      if (scope && scope[1] === null) continue;
      if (isList && opts.list) out[key] = opts.list.map((row) => build(type as Schema, { ...ctx, ...row }, { ...opts, list: undefined }, missing, `${path}${key}.`));
      else out[key] = build(type as Schema, scope ? { ...ctx, ...scope[1]! } : ctx, opts, missing, `${path}${key}.`);
      continue;
    }
    if (!(n in ctx)) { missing.push(`${path}${key}`); continue; }
    let v = ctx[n];
    const t = String(type).toLowerCase();
    if (v instanceof Date || (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v))) {
      const iso = typeof v === "string" ? v : v.toISOString().slice(0, 10);
      v = t.includes("date") || opts.dateFmt === "iso" ? iso : iso.split("-").reverse().join(".");
    } else if (/int|long|short|decimal|double|float/.test(t) && v !== "" && v !== null) v = Number(v);
    out[key] = v;
  }
  return out;
}

/** Yanıtta sonuç kodu, açıklama ve referans numarasını arar */
export function parseResult(res: unknown) {
  let code: string | null = null, message: string | null = null, reference: string | null = null, pdf: string | null = null;
  const errors: string[] = [];
  const walk = (o: unknown) => {
    if (!o || typeof o !== "object") return;
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      const n = norm(k);
      if (v && typeof v === "object") { walk(v); continue; }
      const s = v === null || v === undefined ? "" : String(v);
      if (!s) continue;
      if (/(hatakodu|sonuckod|sonuckodu|islemsonucu|resultcode)$/.test(n) && code === null) code = s;
      else if (/(hataaciklama|hataaciklamasi|sonucaciklama|sonucaciklamasi|islemaciklamasi|mesaj|message)$/.test(n)) { if (!message) message = s; else if (!message.includes(s)) errors.push(s); }
      else if (/referans/.test(n) && !reference) reference = s;
      else if (/pdf|bytes|dosya/.test(n) && s.length > 200) pdf = s;
    }
  };
  walk(res);
  const ok = code === null ? !!reference : ["0", "00", "000"].includes(String(code).trim());
  return { ok, code, message: [message, ...errors].filter(Boolean).join(" · ") || null, reference, pdf };
}

/** Yanıttan şifre ve uzun ikili alanları temizler (günlüğe yazmak için) */
export function sanitize(o: unknown, depth = 0): unknown {
  if (depth > 6 || o === null || typeof o !== "object") return typeof o === "string" && o.length > 300 ? `${o.slice(0, 40)}… (${o.length} karakter)` : o;
  if (Array.isArray(o)) return o.slice(0, 50).map((x) => sanitize(x, depth + 1));
  return Object.fromEntries(Object.entries(o as Record<string, unknown>).filter(([k]) => !/sifre|password|token/i.test(k)).map(([k, v]) => [k, sanitize(v, depth + 1)]));
}

export async function call(c: soap.Client, opName: string, args: Record<string, unknown>) {
  const fn = (c as unknown as Record<string, (a: unknown) => Promise<[unknown]>>)[`${opName}Async`];
  if (!fn) throw new Error(`SGK servisinde ${opName} metodu yok`);
  const [res] = await fn.call(c, args);
  return res;
}
