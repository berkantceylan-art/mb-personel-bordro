import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

/**
 * Davet koduyla hesap hazırlama.
 * Sunucuda service_role anahtarıyla çalışır (Vercel ortam değişkeni SUPABASE_SERVICE_ROLE_KEY; koda/istemciye asla girmez).
 * - Hesap yoksa e-posta onayı beklemeden oluşturur.
 * - Hesap daha önce yarım kalmış bir denemeden kalmışsa (hiçbir şirkete bağlı değilse) şifresini yeniler.
 * Ardından istemci bu şifreyle giriş yapıp claim_invite çağırır.
 */
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" };
const reply = (status: number, body: object) => NextResponse.json(body, { status, headers: CORS });

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function POST(req: Request) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!key || !url) return reply(501, { error: "Sunucu davet servisi ayarlı değil" });

  let code = "";
  let password = "";
  try {
    const b = (await req.json()) as { code?: string; password?: string };
    code = String(b.code ?? "").trim().toUpperCase();
    password = String(b.password ?? "");
  } catch {
    return reply(400, { error: "Geçersiz istek" });
  }
  if (!/^[A-Z0-9]{4,12}$/.test(code)) return reply(400, { error: "Davet kodu geçersiz" });
  if (password.length < 6 || password.length > 72) return reply(400, { error: "Şifre 6–72 karakter olmalı" });

  const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: inv } = await admin.from("invites").select("id, login_email, used_at, used_by, expires_at").eq("code", code).maybeSingle();
  if (!inv) return reply(404, { error: "Davet kodu bulunamadı" });
  if (inv.used_at) return reply(409, { error: "Bu davet kodu kullanılmış; kullanıcı adınız ve şifrenizle giriş yapın" });
  if (new Date(inv.expires_at) < new Date()) return reply(410, { error: "Davet kodunun süresi dolmuş" });

  const email = String(inv.login_email).toLowerCase();
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (!created.error) return reply(200, { ok: true, email });

  // Hesap zaten var: yarım kalmış denemeyse şifreyi yenile
  let userId: string | null = null;
  for (let page = 1; page <= 20 && !userId; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error || !data.users.length) break;
    userId = data.users.find((u) => u.email?.toLowerCase() === email)?.id ?? null;
    if (data.users.length < 1000) break;
  }
  if (!userId) return reply(500, { error: created.error.message });
  const { count } = await admin.from("memberships").select("user_id", { count: "exact", head: true }).eq("user_id", userId);
  if ((count ?? 0) > 0) return reply(409, { error: "Bu kullanıcı adıyla zaten bir hesap var. Giriş ekranından şifrenizle girin; şifreyi unuttuysanız yöneticinize yeni davet kodu ürettirin." });
  const { error: upd } = await admin.auth.admin.updateUserById(userId, { password, email_confirm: true });
  if (upd) return reply(500, { error: upd.message });
  return reply(200, { ok: true, email });
}
