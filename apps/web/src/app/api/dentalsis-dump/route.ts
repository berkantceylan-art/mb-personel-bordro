import { createHash, timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Geçici: Dentalsis Plus'tan (eski iş takip programı) 2026 kayıtlarının ham dökümünü alır.
 * Döküm, kullanıcının kendi Dentalsis oturumundan tarayıcıda okunup parça parça buraya gönderilir;
 * dosyalar documents/dentalsis/ altına yazılır ve "Dentalsis'ten aktar" ekranı bunları ERP'ye işler.
 * Tek seferlik anahtarın yalnız SHA-256 özeti kodda durur. Aktarım bitince bu uç kaldırılacak.
 */
export const runtime = "nodejs";
export const maxDuration = 60;

const KEY_SHA256 = "6de945f06c565ca44379239dba8b9cfd27aff6f7f859ea3383ca2b94551902a3";
const ORIGIN = "https://dentalsisplus.dentalofisi.com";
const cors = { "Access-Control-Allow-Origin": ORIGIN, "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "content-type", Vary: "Origin" };

export function OPTIONS() {
  return new Response(null, { status: 204, headers: cors });
}

export async function POST(req: Request) {
  const res = (status: number, body: unknown) => Response.json(body, { status, headers: cors });
  const text = await req.text();
  if (text.length > 4_000_000) return res(413, { ok: false, error: "too_large" });
  let p: { k?: string; name?: string; data?: unknown };
  try { p = JSON.parse(text); } catch { return res(400, { ok: false, error: "bad_json" }); }
  const got = createHash("sha256").update(String(p.k ?? "")).digest();
  if (!timingSafeEqual(got, Buffer.from(KEY_SHA256, "hex"))) return res(403, { ok: false, error: "forbidden" });
  if (!p.name || !/^[a-z0-9][a-z0-9-]{0,60}$/.test(p.name) || p.data === undefined) return res(400, { ok: false, error: "bad_request" });
  const admin = createAdminClient();
  const up = await admin.storage.from("documents").upload(`dentalsis/${p.name}.json`, Buffer.from(JSON.stringify(p.data)), { contentType: "application/json", upsert: true });
  if (up.error) return res(500, { ok: false, error: up.error.message });
  return res(200, { ok: true, name: p.name });
}
