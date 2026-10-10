import { NextResponse } from "next/server";
import { safePath } from "@/lib/handoff";
import { createClient } from "@/lib/supabase/server";

/**
 * ERP'den siteye tek girişle geçiş (POST): ERP'nin ürettiği tek kullanımlık giriş anahtarıyla
 * sitede oturum açılır ve kişi yönetim paneline alınır.
 */
export async function POST(req: Request) {
  const origin = new URL(req.url).origin;
  const form = await req.formData().catch(() => null);
  const hash = String(form?.get("token_hash") ?? "");
  const next = safePath(form?.get("sonra"), "/admin");
  if (!/^[A-Za-z0-9_-]{20,200}$/.test(hash)) return NextResponse.redirect(`${origin}/giris?hata=baglanti`, 303);
  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ type: "magiclink", token_hash: hash });
  if (error) {
    console.error("[gecis] verifyOtp:", error.message);
    return NextResponse.redirect(`${origin}/giris?hata=baglanti&sonra=${encodeURIComponent(next)}`, 303);
  }
  return NextResponse.redirect(`${origin}${next}`, 303);
}
