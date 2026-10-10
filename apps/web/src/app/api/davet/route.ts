import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

/**
 * Davet koduyla hesap açma — yalnız sunucuda, service_role ile (anahtar Vercel ortam değişkeninde; istemciye gitmez).
 *  { code }            → ön izleme (şirket, ad, kullanıcı adı)
 *  { code, password }  → hesabı hazırlar: yoksa oluşturur; varsa (güvenlik koşulları sağlanıyorsa) şifresini
 *                        yeniler — yöneticinin ürettiği kod "şifre sıfırlama kodu" olarak da çalışır.
 *                        Ardından istemci giriş yapıp claim_invite çağırır.
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
  const { data: inv } = await admin.from("invites").select("id, company_id, role, employee_id, created_by, login_email, used_at, expires_at, created_at").eq("code", code).maybeSingle();
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
  // Hesap var: geçerli davet kodu aynı zamanda ŞİFRE SIFIRLAMA kodudur (yönetici üretir).
  const block = await resetBlocked(admin, inv, user.id);
  if (block) return reply(409, { error: block });
  const { error: upd } = await admin.auth.admin.updateUserById(user.id, { password, email_confirm: true });
  if (upd) {
    console.error("[davet] updateUserById:", upd.status, upd.code, upd.message);
    return reply(upd.code === "weak_password" ? 400 : 500, { error: passwordProblem(upd) ?? "Hesap hazırlanamadı. Lütfen tekrar deneyin." });
  }
  return reply(200, { ok: true, email, reset: true });
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

/** İK'nın kod üretebildiği roller; daha yetkili hesapların şifresi bu yolla sıfırlanamaz */
const HR_ROLES = ["employee", "branch_manager", "safety"];
type Inv = { company_id: string; role: string; employee_id: string | null; created_by: string | null };

/**
 * Var olan hesabın şifresi davet koduyla yenilenebilir mi? Engel varsa nedenini döndürür.
 * - Hesap yalnız bu şirkete ve davetteki rolle bağlı olmalı (başka şirket / başka rol yok)
 * - Şirket sahibi hesabı bu yolla sıfırlanmaz; İK/muhasebe/editör hesabı için kodu şirket sahibi üretmiş olmalı
 * - Davet bir personel kaydına bağlıysa, o kayıt başka bir hesaba bağlı olmamalı
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function resetBlocked(admin: any, inv: Inv, userId: string): Promise<string | null> {
  const contact = "Yöneticinizle görüşün.";
  const { data: ms } = await admin.from("memberships").select("company_id, role").eq("user_id", userId);
  const list = (ms ?? []) as Array<{ company_id: string; role: string }>;
  if (list.some((m) => m.company_id !== inv.company_id || m.role !== inv.role)) {
    return `Bu kullanıcı adı farklı bir role ya da şirkete bağlı; davet koduyla şifresi yenilenemez. ${contact}`;
  }
  if (inv.role === "owner") return "Şirket sahibi hesabının şifresi davet koduyla yenilenemez. Giriş ekranındaki \"Şifremi unuttum\" ile e-postanıza bağlantı isteyin.";
  if (!HR_ROLES.includes(inv.role)) {
    const { data: cr } = await admin.from("memberships").select("role").eq("user_id", inv.created_by ?? "").eq("company_id", inv.company_id).maybeSingle();
    if (cr?.role !== "owner") return `Bu hesabın şifre sıfırlama kodunu yalnız şirket sahibi üretebilir. ${contact}`;
  }
  if (inv.employee_id) {
    const { data: e } = await admin.from("employees").select("user_id").eq("id", inv.employee_id).maybeSingle();
    if (e?.user_id && e.user_id !== userId) return `Bu personel kaydı başka bir hesaba bağlı. ${contact}`;
  }
  return null;
}
