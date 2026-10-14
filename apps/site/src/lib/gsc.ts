// Google Search Console: Google aramada görüntülenme / tıklama (servis hesabıyla, salt okunur)
//  GSC_SERVICE_ACCOUNT : servis hesabı JSON anahtarı (düz ya da base64)
//  GSC_SITE_URL        : Search Console mülkü, ör. "sc-domain:mbdentaire.com" ya da "https://mbdentaire.com/"
import { createSign } from "node:crypto";

type Creds = { client_email: string; private_key: string };
export type GscRow = { keys: string[]; clicks: number; impressions: number; ctr: number; position: number };
export type GscReport = { configured: boolean; error?: string; site?: string; totals?: { clicks: number; impressions: number; ctr: number; position: number }; prev?: { clicks: number; impressions: number };
  days?: GscRow[]; queries?: GscRow[]; pages?: GscRow[]; countries?: GscRow[]; devices?: GscRow[]; appearance?: GscRow[] };

function creds(): Creds | null {
  const raw = process.env.GSC_SERVICE_ACCOUNT;
  if (!raw) return null;
  try {
    const txt = raw.trim().startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8");
    const j = JSON.parse(txt) as Creds;
    return j.client_email && j.private_key ? { client_email: j.client_email, private_key: j.private_key.replace(/\\n/g, "\n") } : null;
  } catch { return null; }
}
const b64u = (s: string | Buffer) => Buffer.from(s).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");

async function token(c: Creds): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const head = b64u(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const body = b64u(JSON.stringify({ iss: c.client_email, scope: "https://www.googleapis.com/auth/webmasters.readonly", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 }));
  const sig = b64u(createSign("RSA-SHA256").update(`${head}.${body}`).sign(c.private_key));
  const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${head}.${body}.${sig}` }), cache: "no-store" });
  const j = (await r.json()) as { access_token?: string; error_description?: string };
  if (!j.access_token) throw new Error(j.error_description ?? "Google oturumu açılamadı");
  return j.access_token;
}

export async function gscReport(from: string, to: string, prevFrom: string, prevTo: string): Promise<GscReport> {
  const c = creds();
  const site = process.env.GSC_SITE_URL || "sc-domain:mbdentaire.com";
  if (!c) return { configured: false, site };
  try {
    const tk = await token(c);
    const q = async (body: Record<string, unknown>) => {
      const r = await fetch(`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(site)}/searchAnalytics/query`, {
        method: "POST", headers: { authorization: `Bearer ${tk}`, "content-type": "application/json" }, body: JSON.stringify(body), next: { revalidate: 3600 } });
      const j = (await r.json()) as { rows?: GscRow[]; error?: { message: string } };
      if (j.error) throw new Error(j.error.message);
      return j.rows ?? [];
    };
    const base = { startDate: from, endDate: to, dataState: "all" };
    const [tot, prev, days, queries, pages, countries, devices, appearance] = await Promise.all([
      q(base), q({ startDate: prevFrom, endDate: prevTo }), q({ ...base, dimensions: ["date"] }), q({ ...base, dimensions: ["query"], rowLimit: 25 }),
      q({ ...base, dimensions: ["page"], rowLimit: 15 }), q({ ...base, dimensions: ["country"], rowLimit: 10 }), q({ ...base, dimensions: ["device"] }),
      q({ ...base, dimensions: ["searchAppearance"] }).catch(() => []),
    ]);
    const t0 = tot[0];
    return { configured: true, site, totals: t0 ? { clicks: t0.clicks, impressions: t0.impressions, ctr: t0.ctr, position: t0.position } : { clicks: 0, impressions: 0, ctr: 0, position: 0 },
      prev: prev[0] ? { clicks: prev[0].clicks, impressions: prev[0].impressions } : { clicks: 0, impressions: 0 }, days, queries, pages, countries, devices, appearance };
  } catch (e) {
    return { configured: true, site, error: e instanceof Error ? e.message : "Search Console okunamadı" };
  }
}
