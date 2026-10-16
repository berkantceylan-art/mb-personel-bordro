import { createHash } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { importPunchText } from "@/lib/pdks-import";

/**
 * PDKS otomatik aktarım ucu. Ofisteki "MB Dental PDKS aktarıcı" programı Erom'un yazdığı okutma dosyasının
 * yeni satırlarını 5 dakikada bir buraya gönderir: Authorization: Bearer <anahtar>, gövde düz metin.
 * Anahtarın yalnız SHA-256 özeti veritabanında durur (Puantaj > Otomatik aktarım ekranında oluşturulur).
 */
export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!/^[a-f0-9]{64}$/.test(token)) return Response.json({ ok: false, error: "forbidden" }, { status: 403 });
  const admin = createAdminClient();
  const hash = createHash("sha256").update(token).digest("hex");
  const { data: agent } = await admin.from("pdks_agents").select("id, company_id, is_active").eq("token_hash", hash).maybeSingle();
  if (!agent || !agent.is_active) return Response.json({ ok: false, error: "forbidden" }, { status: 403 });

  const text = await req.text();
  if (text.length > 5_000_000) return Response.json({ ok: false, error: "too_large" }, { status: 413 });
  const fileName = (req.headers.get("x-file-name") ?? "erom-otomatik").replace(/[^\w.\- ]/g, "").slice(0, 120) || "erom-otomatik";
  const at = new Date().toISOString();
  if (!text.trim()) {
    await admin.from("pdks_agents").update({ last_seen_at: at, last_result: { at, read: 0, inserted: 0, note: "yeni satır yok" } }).eq("id", agent.id);
    return Response.json({ ok: true, read: 0, inserted: 0 });
  }
  const r = await importPunchText(admin, agent.company_id as string, text, `Otomatik · ${fileName}`, null, { skipEmptyLog: true });
  const result = { at, ok: r.ok, read: r.read, inserted: r.inserted, dup: r.dup, errors: r.errors.length, unknown: [...r.unknown.keys()].slice(0, 20), message: r.message };
  await admin.from("pdks_agents").update({ last_seen_at: at, last_result: result }).eq("id", agent.id);
  return Response.json(result, { status: r.ok || r.read === 0 ? 200 : 500 });
}
