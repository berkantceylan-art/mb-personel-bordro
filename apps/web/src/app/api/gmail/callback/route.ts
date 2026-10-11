import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { gmailConfigured, redirectUri, seal, verifyState } from "@/lib/gmail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COLORS = ["#2563EB", "#DC2626", "#059669", "#D97706", "#7C3AED", "#DB2777", "#0891B2", "#4B5563"];

/** Google dönüşü: kodu anahtarla değiştirir, yenileme anahtarını şifreleyip hesabı kaydeder */
export async function GET(req: NextRequest) {
  const back = (q: string) => {
    const r = NextResponse.redirect(new URL(`/posta?${q}`, req.url));
    r.cookies.set("gmail_oauth", "", { path: "/api/gmail", maxAge: 0 });
    return r;
  };
  const s = await getSession();
  if (!gmailConfigured()) return back("hata=ayar");
  const sp = req.nextUrl.searchParams;
  if (sp.get("error")) return back("hata=iptal");
  const payload = verifyState(sp.get("state") ?? "");
  const [uid, nonce, ts] = (payload ?? "").split(":");
  if (!payload || uid !== s.userId || nonce !== req.cookies.get("gmail_oauth")?.value || Date.now() - Number(ts) > 15 * 60_000) return back("hata=oturum");
  const code = sp.get("code");
  if (!code) return back("hata=iptal");

  const tr = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id: process.env.GOOGLE_CLIENT_ID!, client_secret: process.env.GOOGLE_CLIENT_SECRET!, redirect_uri: redirectUri(req.nextUrl.origin), grant_type: "authorization_code" }),
    cache: "no-store",
  });
  const t = (await tr.json()) as { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string; error?: string };
  if (!tr.ok || !t.access_token) return back("hata=google");
  if (!(t.scope ?? "").includes("gmail.modify")) return back("hata=izin");

  const ur = await fetch("https://openidconnect.googleapis.com/v1/userinfo", { headers: { authorization: `Bearer ${t.access_token}` }, cache: "no-store" });
  const u = (await ur.json()) as { email?: string; name?: string };
  const email = (u.email ?? "").toLowerCase();
  if (!email) return back("hata=google");

  const admin = createAdminClient();
  const { data: existing } = await admin.from("mail_accounts").select("id").eq("user_id", s.userId).eq("email", email).maybeSingle();
  const common = {
    access_token_enc: seal(t.access_token),
    access_expires_at: new Date(Date.now() + (t.expires_in ?? 3600) * 1000).toISOString(),
    scopes: (t.scope ?? "").slice(0, 1000),
    status: "active",
    last_error: null,
    updated_at: new Date().toISOString(),
    ...(t.refresh_token ? { refresh_token_enc: seal(t.refresh_token) } : {}),
  };
  let id = existing?.id as string | undefined;
  if (id) {
    const { error } = await admin.from("mail_accounts").update(common).eq("id", id);
    if (error) return back("hata=kayit");
  } else {
    if (!t.refresh_token) return back("hata=yenile");
    const { count } = await admin.from("mail_accounts").select("id", { count: "exact", head: true }).eq("user_id", s.userId);
    if ((count ?? 0) >= 10) return back("hata=sinir");
    const { data, error } = await admin.from("mail_accounts")
      .insert({ ...common, company_id: s.companyId, user_id: s.userId, email, display_name: (u.name ?? "").slice(0, 120) || null, color: COLORS[(count ?? 0) % COLORS.length] })
      .select("id").single();
    if (error) return back(/mail_accounts/.test(error.message) ? "hata=sql" : "hata=kayit");
    id = data.id as string;
  }
  return back(`a=${id}&ok=1`);
}
