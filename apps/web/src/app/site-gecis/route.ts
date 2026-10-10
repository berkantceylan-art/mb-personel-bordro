import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { SITE_URL, autoPost, safePath } from "@/lib/handoff";

/**
 * ERP'den web sitesi yönetimine tek girişle geçiş.
 * Yetkili kullanıcı için tek kullanımlık giriş anahtarı üretilir ve siteye POST edilir;
 * site bu anahtarla kendi oturumunu açar.
 */
export async function GET(req: Request) {
  const s = await getSession();
  const origin = new URL(req.url).origin;
  if (!s.siteAccess || !s.email) return NextResponse.redirect(`${origin}/?hata=site`, 303);
  const next = safePath(new URL(req.url).searchParams.get("sonra"), "/admin");
  try {
    const { data, error } = await createAdminClient().auth.admin.generateLink({ type: "magiclink", email: s.email });
    const hash = data?.properties?.hashed_token;
    if (error || !hash) throw new Error(error?.message ?? "anahtar yok");
    return autoPost(`${SITE_URL}/auth/gecis`, { token_hash: hash, sonra: next }, "Web sitesi yönetimine geçiliyor…");
  } catch (e) {
    console.error("[site-gecis]", (e as Error).message);
    return NextResponse.redirect(`${SITE_URL}/giris?sonra=${encodeURIComponent(next)}`, 303);
  }
}
