import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { SITE_URL, autoPost } from "@/lib/handoff";

/**
 * Kullanıcı olarak görüntüleme (POST, yalnız şirket sahibi): hedef kişinin ekranı şifresiz,
 * yalnız görüntüleme modunda açılır. ERP kullanıcısı bu tarayıcıda, klinik / hekim web sitesi portalında açılır.
 */
export async function POST(req: Request) {
  const origin = new URL(req.url).origin;
  const back = (q: string) => NextResponse.redirect(`${origin}/yonetim/goruntule?hata=${q}`, 303);
  const form = await req.formData().catch(() => null);
  const target = String(form?.get("target") ?? "");
  const reason = String(form?.get("reason") ?? "").slice(0, 200);
  if (!/^[0-9a-f-]{36}$/.test(target)) return back("hedef");

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("imp_start", { p_target: target, p_reason: reason || null });
  if (error) {
    const m = error.message;
    return back(/not_owner/.test(m) ? "yetki" : /self/.test(m) ? "kendi" : /readonly/.test(m) ? "ic-ice" : /no_email/.test(m) ? "eposta" : /imp_start|does not exist/.test(m) ? "sql" : "hedef");
  }
  const info = data as { id: string; email: string; kind: "erp" | "portal" };
  let admin;
  try { admin = createAdminClient(); } catch { return back("anahtar"); }
  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({ type: "magiclink", email: info.email });
  const hash = link?.properties?.hashed_token;
  if (linkErr || !hash) { console.error("[goruntule] generateLink:", linkErr?.message); return back("baglanti"); }

  if (info.kind === "portal") {
    return autoPost(`${SITE_URL}/auth/goruntule`, { token_hash: hash, log: info.id }, "Klinik / hekim ekranı açılıyor (yalnız görüntüleme)…");
  }

  const { error: vErr } = await supabase.auth.verifyOtp({ type: "magiclink", token_hash: hash });
  if (vErr) { console.error("[goruntule] verifyOtp:", vErr.message); return back("baglanti"); }
  const { error: cErr } = await supabase.rpc("imp_claim", { p_log: info.id });
  if (cErr) {
    // Salt okunur işaretlenemeyen oturum açık bırakılmaz
    await supabase.auth.signOut({ scope: "local" });
    console.error("[goruntule] claim:", cErr.message);
    return NextResponse.redirect(`${origin}/giris?hata=goruntule`, 303);
  }
  const res = NextResponse.redirect(`${origin}/`, 303);
  res.cookies.set("mb_imp", "1", { path: "/", httpOnly: true, sameSite: "lax", secure: true, maxAge: 3600 });
  return res;
}
