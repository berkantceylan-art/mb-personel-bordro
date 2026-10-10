import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/** E-posta onayı / sihirli bağlantı dönüşü: kodu oturuma çevir, hedefe yönlendir */
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("sonra") ?? "/portal";
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/portal";
  // Şablonda token_hash kullanılırsa (e-posta onayı, davet, sihirli bağlantı)
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type");
  if (tokenHash && type && ["signup", "email", "magiclink", "invite", "recovery", "email_change"].includes(type)) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: type as "signup" | "email" | "magiclink" | "invite" | "recovery" | "email_change" });
    if (!error) return NextResponse.redirect(new URL(safeNext, url.origin));
  }
  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(safeNext, url.origin));
  }
  return NextResponse.redirect(new URL("/giris?hata=baglanti", url.origin));
}
