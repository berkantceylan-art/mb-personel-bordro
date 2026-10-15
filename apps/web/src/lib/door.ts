import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Kapı rölesi (Shelly Cloud). Röle Erom panelinin "çıkış butonu" uçlarına paralel bağlıdır;
 * kısa süre kapanması butona basılmış gibi kapıyı açar. Kilit ve kart sistemi Erom'da kalır.
 * Ortam değişkenleri (Vercel): SHELLY_CLOUD_SERVER (ör. shelly-123-eu.shelly.cloud), SHELLY_CLOUD_KEY
 */
export function doorConfigured() {
  return !!(process.env.SHELLY_CLOUD_SERVER && process.env.SHELLY_CLOUD_KEY);
}

function host() {
  const h = (process.env.SHELLY_CLOUD_SERVER ?? "").trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)*\.shelly\.cloud$/i.test(h)) throw new Error("SHELLY_CLOUD_SERVER geçersiz (ör. shelly-123-eu.shelly.cloud)");
  return h;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function call(url: string, init: RequestInit) {
  const r = await fetch(url, { ...init, cache: "no-store", signal: AbortSignal.timeout(8000) });
  const text = await r.text();
  let j: { isok?: boolean; error?: unknown; errors?: unknown } | null = null;
  try { j = JSON.parse(text); } catch { /* düz metin */ }
  return { status: r.status, ok: r.ok && j?.isok !== false && !j?.error, body: j ?? text };
}

/** Röleyi `pulse` saniye kapatıp bırakır */
export async function pulseRelay(device: string, channel: number, pulse: number): Promise<{ ok: boolean; message: string }> {
  if (!doorConfigured()) return { ok: false, message: "Kapı rölesi bağlantısı kurulmamış (Vercel: SHELLY_CLOUD_SERVER, SHELLY_CLOUD_KEY)" };
  const key = process.env.SHELLY_CLOUD_KEY!;
  const base = `https://${host()}`;
  try {
    // v2: toggle_after ile tek istekte aç-kapat
    const v2 = await call(`${base}/v2/devices/api/set/switch?auth_key=${encodeURIComponent(key)}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: device, channel, on: true, toggle_after: pulse }),
    });
    if (v2.ok) return { ok: true, message: "Kapı açıldı" };
    if (v2.status !== 404 && v2.status !== 405) return { ok: false, message: `Röle yanıtı: ${v2.status} ${shortErr(v2.body)}` };
    // v1 yedek: aç, bekle, kapat
    const form = (turn: "on" | "off") => new URLSearchParams({ auth_key: key, id: device, channel: String(channel), turn });
    const on = await call(`${base}/device/relay/control`, { method: "POST", body: form("on") });
    if (!on.ok) return { ok: false, message: `Röle yanıtı: ${on.status} ${shortErr(on.body)}` };
    await wait(Math.max(1100, pulse * 1000));
    await call(`${base}/device/relay/control`, { method: "POST", body: form("off") }).catch(() => null);
    return { ok: true, message: "Kapı açıldı" };
  } catch (e) {
    return { ok: false, message: (e as Error).name === "TimeoutError" ? "Röleye ulaşılamadı (zaman aşımı)" : (e as Error).message };
  }
}

function shortErr(b: unknown) {
  const s = typeof b === "string" ? b : JSON.stringify(b);
  return s.replace(/auth_key=[^&"\s]+/g, "auth_key=***").slice(0, 160);
}

/** Bekleyen kapı olayını (girişte ya da elle oluşturulan) sahiplenip röleyi tetikler */
export async function fireDoor(sb: SupabaseClient, eventId: string): Promise<{ ok: boolean; message: string }> {
  const { data, error } = await sb.rpc("door_claim", { p_id: eventId });
  if (error) return { ok: false, message: error.message };
  const d = data as { device: string; channel: number; pulse: number };
  const r = await pulseRelay(d.device, d.channel ?? 0, d.pulse ?? 1);
  await sb.rpc("door_result", { p_id: eventId, p_ok: r.ok, p_message: r.message });
  return r;
}
