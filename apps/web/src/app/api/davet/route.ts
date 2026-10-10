import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

/**
 * Davet koduyla hesap açma — yalnız sunucuda, service_role ile (anahtar Vercel ortam değişkeninde; istemciye gitmez).
 *  { code }            → ön izleme (şirket, ad, kullanıcı adı)
 *  { code, password }  → hesabı hazırlar: yoksa oluşturur; davetten SONRA açılıp yarım kalmış ve hiçbir şirkete
 *                        bağlanmamış hesabın şifresini yeniler. Ardından istemci giriş yapıp claim_invite çağırır.
 * Kötüye kullanıma karşı: IP başına 15 dakikada 10 deneme, tüm geçersiz durumlarda tek tip mesaj.
 */
const INVALID = "Davet kodu geçersiz, kullanılmış ya da süresi dolmuş.";
const reply = (status: number, body: object) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
const norm = (c: string) => c.replace(/[^A-Za-z0-9]/g, "").toUpperCase();

export async function POST(req: Request) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!key || !url) return reply(501, { error: "Sunucu davet servisi ayarlı değil" });

  let code = "";
  let password: string | null = null;
  try {
    const b = (await req.json()) as { code?: string; password?: string };
    code = norm(String(b.code ?? ""));
    password = typeof b.password === "string" ? b.password : null;
  } catch {
    return reply(400, { error: "Geçersiz istek" });
  }

  const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0]!.trim() || req.headers.get("x-real-ip") || "unknown";
  const { data: allowed } = await admin.rpc("invite_rate_ok", { p_key: `ip:${ip}` });
  if (allowed === false) return reply(429, { error: "Çok fazla deneme. 15 dakika sonra tekrar deneyin." });

  if (!/^[A-Z0-9]{6,16}$/.test(code)) return reply(404, { error: INVALID });
  const { data: inv } = await admin.from("invites").select("id, login_email, used_at, expires_at, created_at").eq("code", code).maybeSingle();
  if (!inv || inv.used_at || new Date(inv.expires_at) < new Date()) return reply(404, { error: INVALID });

  // Ön izleme
  if (password === null) {
    const { data: p } = await admin.rpc("invite_preview", { p_code: code });
    return reply(200, { ok: true, preview: p });
  }

  if (password.length < 6 || password.length > 72) return reply(400, { error: "Şifre 6–72 karakter olmalı" });
  const email = String(inv.login_email).toLowerCase();
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (!created.error) return reply(200, { ok: true, email });
  console.error("[davet] createUser:", created.error.status, created.error.code, created.error.message);

  // Şifre Supabase'in şifre kuralına takıldıysa bunu açıkça söyle
  const weak = passwordProblem(created.error);
  if (weak) return reply(400, { error: weak });

  // Hesap zaten var mı
  const user = await findUser(admin, email);
  if (!user) return reply(500, { error: `Hesap oluşturulamadı (${created.error.message}). Lütfen yöneticinize bildirin.` });
  const { count } = await admin.from("memberships").select("user_id", { count: "exact", head: true }).eq("user_id", user.id);
  const halfFinished = (count ?? 0) === 0 && new Date(user.created_at) >= new Date(inv.created_at);
  if (!halfFinished) {
    return reply(409, { error: "Bu kullanıcı adıyla zaten bir hesap var. Giriş ekranından şifrenizle girin; şifrenizi unuttuysanız yöneticinize yeni davet kodu ürettirin." });
  }
  const { error: upd } = await admin.auth.admin.updateUserById(user.id, { password, email_confirm: true });
  if (upd) {
    console.error("[davet] updateUserById:", upd.status, upd.code, upd.message);
    return reply(upd.code === "weak_password" ? 400 : 500, { error: passwordProblem(upd) ?? "Hesap hazırlanamadı. Lütfen tekrar deneyin." });
  }
  return reply(200, { ok: true, email });
}

type AuthErr = { code?: string; message: string };

/** Supabase şifre kuralı hatalarını Türkçe, anlaşılır cümleye çevirir */
function passwordProblem(e: AuthErr): string | null {
  const m = e.message ?? "";
  if (e.code !== "weak_password" && !/password/i.test(m)) return null;
  const len = /at least (\d+) characters/i.exec(m)?.[1];
  if (len) return `Şifre en az ${len} karakter olmalı.`;
  if (/one character of each/i.test(m)) {
    const need: string[] = [];
    if (/abcdefghijklmnopqrstuvwxyz/.test(m)) need.push("küçük harf");
    if (/ABCDEFGHIJKLMNOPQRSTUVWXYZ/.test(m)) need.push("büyük harf");
    if (/0123456789/.test(m)) need.push("rakam");
    if (/[!@#$%^&*]/.test(m.replace(/.*0123456789/, ""))) need.push("sembol (!, ?, # gibi)");
    return `Şifre şunları içermeli: ${need.join(", ") || "harf ve rakam"}.`;
  }
  if (/weak|easy to guess|pwned|leaked/i.test(m)) return "Bu şifre çok yaygın ya da daha önce sızdırılmış. Daha güçlü bir şifre seçin (harf, rakam ve sembol karışık).";
  if (e.code === "weak_password") return "Şifre yeterince güçlü değil. Daha uzun ve harf, rakam karışık bir şifre seçin.";
  return null;
}

/** E-postayla kullanıcı bul: önce güvenli RPC, olmazsa yönetici listesi */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function findUser(admin: any, email: string): Promise<{ id: string; created_at: string } | null> {
  const { data, error } = await admin.rpc("auth_user_by_email", { p_email: email });
  if (!error) return (data as Array<{ id: string; created_at: string }> | null)?.[0] ?? null;
  console.error("[davet] auth_user_by_email:", error.message);
  for (let page = 1; page <= 20; page++) {
    const { data: list, error: e } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (e || !list) return null;
    const u = (list.users as Array<{ id: string; email?: string; created_at: string }>).find((x) => (x.email ?? "").toLowerCase() === email);
    if (u) return { id: u.id, created_at: u.created_at };
    if (list.users.length < 200) return null;
  }
  return null;
}
