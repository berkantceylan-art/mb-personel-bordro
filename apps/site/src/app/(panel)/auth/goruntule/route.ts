import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * ERP'den "kullanıcı olarak görüntüle" (POST): klinik / hekim hesabı şifresiz açılır ve oturum
 * veritabanında YALNIZ GÖRÜNTÜLEME oturumu olarak işaretlenir (işaretlenemezse oturum kapatılır).
 */
export async function POST(req: Request) {
  const origin = new URL(req.url).origin;
  const form = await req.formData().catch(() => null);
  const hash = String(form?.get("token_hash") ?? "");
  const log = String(form?.get("log") ?? "");
  if (!/^[A-Za-z0-9_-]{20,200}$/.test(hash) || !/^[0-9a-f-]{36}$/.test(log)) return NextResponse.redirect(`${origin}/giris?hata=baglanti`, 303);
  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ type: "magiclink", token_hash: hash });
  if (error) {
    console.error("[goruntule] verifyOtp:", error.message);
    return NextResponse.redirect(`${origin}/giris?hata=baglanti`, 303);
  }
  const { error: cErr } = await supabase.rpc("imp_claim", { p_log: log });
  if (cErr) {
    await supabase.auth.signOut({ scope: "local" });
    console.error("[goruntule] claim:", cErr.message);
    return NextResponse.redirect(`${origin}/giris?hata=baglanti`, 303);
  }
  const res = NextResponse.redirect(`${origin}/portal`, 303);
  res.cookies.set("mb_imp", "1", { path: "/", httpOnly: true, sameSite: "lax", secure: true, maxAge: 3600 });
  return res;
}
