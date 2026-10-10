import { createClient as createPlain } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { safePath } from "@/lib/handoff";

/**
 * Web sitesinden ERP'ye tek girişle geçiş (POST).
 * Site, giriş yapmış kullanıcının erişim anahtarını gönderir; burada Supabase'e doğrulatılır ve
 * aynı kullanıcı için ERP'de AYRI, yeni bir oturum açılır (şifre sorulmaz, site oturumu etkilenmez).
 */
export async function POST(req: Request) {
  const origin = new URL(req.url).origin;
  const back = (q: string) => NextResponse.redirect(`${origin}/giris?${q}`, 303);
  const form = await req.formData().catch(() => null);
  const token = String(form?.get("access_token") ?? "");
  const next = safePath(form?.get("sonra"), "/");
  if (!token) return back("hata=gecis");

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const plain = createPlain(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: who, error: whoErr } = await plain.auth.getUser(token);
  const email = who.user?.email;
  if (whoErr || !email) return back("hata=gecis");

  const supabase = await createClient();
  // Zaten aynı kullanıcıyla girilmişse doğrudan devam
  const { data: cur } = await supabase.auth.getUser();
  if (cur.user?.id === who.user!.id) return NextResponse.redirect(`${origin}${next}`, 303);

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return back("hata=gecis");
  }
  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  const hash = link?.properties?.hashed_token;
  if (linkErr || !hash) {
    console.error("[gecis] generateLink:", linkErr?.message);
    return back("hata=gecis");
  }
  const { error: vErr } = await supabase.auth.verifyOtp({ type: "magiclink", token_hash: hash });
  if (vErr) {
    console.error("[gecis] verifyOtp:", vErr.message);
    return back("hata=gecis");
  }
  return NextResponse.redirect(`${origin}${next}`, 303);
}
