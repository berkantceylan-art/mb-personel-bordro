import { NextResponse } from "next/server";
import { ERP_URL, autoPost, safePath } from "@/lib/handoff";
import { createClient } from "@/lib/supabase/server";

/**
 * Siteden ERP'ye tek girişle geçiş: giriş yapmış kullanıcının erişim anahtarı ERP'ye POST edilir,
 * ERP bunu Supabase'e doğrulatıp kendi (ayrı) oturumunu açar. Şifre tekrar sorulmaz.
 */
export async function GET(req: Request) {
  const origin = new URL(req.url).origin;
  const next = safePath(new URL(req.url).searchParams.get("sonra"), "/");
  if (!ERP_URL) return NextResponse.redirect(`${origin}/admin`, 303);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(`${origin}/giris?kim=personel`, 303);
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) return NextResponse.redirect(`${origin}/giris?kim=personel`, 303);
  return autoPost(`${ERP_URL}/auth/gecis`, { access_token: session.access_token, sonra: next }, "ERP paneline geçiliyor…");
}
