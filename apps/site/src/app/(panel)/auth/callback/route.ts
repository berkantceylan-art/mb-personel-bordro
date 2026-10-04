import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/** E-posta onayı / sihirli bağlantı dönüşü: kodu oturuma çevir, hedefe yönlendir */
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("sonra") ?? "/portal";
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/portal";
  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(safeNext, url.origin));
  }
  return NextResponse.redirect(new URL("/giris?hata=baglanti", url.origin));
}
