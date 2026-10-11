import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

/** WhatsApp Business Platform (Cloud API) istemcisi. Anahtarlar Vercel ortam değişkenlerinde. */
const GRAPH = "https://graph.facebook.com/v21.0";
export const waConfigured = () => !!(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID);

export function waVerifySignature(raw: string, header: string | null): boolean {
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (!secret) return false;
  const exp = `sha256=${createHmac("sha256", secret).update(raw, "utf8").digest("hex")}`;
  const got = header ?? "";
  return got.length === exp.length && timingSafeEqual(Buffer.from(got), Buffer.from(exp));
}

async function post(body: unknown): Promise<{ id: string }> {
  const res = await fetch(`${GRAPH}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
    method: "POST", headers: { authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, "content-type": "application/json" }, body: JSON.stringify(body), cache: "no-store",
  });
  const j = (await res.json()) as { messages?: { id: string }[]; error?: { message?: string; code?: number } };
  if (!res.ok || !j.messages?.[0]) {
    const code = j.error?.code;
    throw new Error(code === 131047 || code === 131026 ? "window_closed" : (j.error?.message ?? `WhatsApp ${res.status}`).slice(0, 200));
  }
  return { id: j.messages[0].id };
}

export const waSendText = (to: string, body: string) => post({ messaging_product: "whatsapp", recipient_type: "individual", to, type: "text", text: { preview_url: false, body: body.slice(0, 4096) } });

/** 24 saat penceresi kapalıysa onaylı şablon (WHATSAPP_TEMPLATE, tek değişkenli gövde) */
export const waSendTemplate = (to: string, text: string) => {
  const name = process.env.WHATSAPP_TEMPLATE;
  if (!name) throw new Error("no_template");
  return post({ messaging_product: "whatsapp", to, type: "template", template: { name, language: { code: process.env.WHATSAPP_TEMPLATE_LANG || "tr" }, components: [{ type: "body", parameters: [{ type: "text", text: text.slice(0, 1000) }] }] } });
};

export async function waMedia(id: string): Promise<{ data: ArrayBuffer; mime: string }> {
  const meta = await fetch(`${GRAPH}/${encodeURIComponent(id)}`, { headers: { authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` }, cache: "no-store" });
  const m = (await meta.json()) as { url?: string; mime_type?: string };
  if (!meta.ok || !m.url) throw new Error("media_not_found");
  const bin = await fetch(m.url, { headers: { authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` }, cache: "no-store" });
  if (!bin.ok) throw new Error("media_not_found");
  return { data: await bin.arrayBuffer(), mime: m.mime_type ?? "application/octet-stream" };
}
