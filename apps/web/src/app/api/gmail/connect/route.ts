import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/session";
import { GMAIL_SCOPES, gmailConfigured, redirectUri, signState } from "@/lib/gmail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Gmail hesabı bağla: Google izin ekranına yönlendirir (oturum açmış kullanıcı) */
export async function GET(req: NextRequest) {
  const s = await getSession();
  if (!gmailConfigured()) return NextResponse.redirect(new URL("/posta?hata=ayar", req.url));
  const nonce = randomBytes(16).toString("base64url");
  const state = signState(`${s.userId}:${nonce}:${Date.now()}`);
  const p = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: redirectUri(req.nextUrl.origin),
    response_type: "code",
    scope: GMAIL_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent select_account",
    include_granted_scopes: "true",
    state,
  });
  const hint = req.nextUrl.searchParams.get("email");
  if (hint && /^[^@\s]+@[^@\s]+$/.test(hint)) p.set("login_hint", hint);
  const res = NextResponse.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${p}`);
  res.cookies.set("gmail_oauth", nonce, { httpOnly: true, secure: true, sameSite: "lax", path: "/api/gmail", maxAge: 900 });
  return res;
}
