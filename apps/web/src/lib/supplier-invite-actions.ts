"use server";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export interface InviteResult { ok: boolean; message: string }

/** Tedarikçi davetini kabul: hesap oluştur (şifreyi tedarikçi kendisi belirler) ve giriş yap */
export async function supInviteAccept(_: InviteResult | null, f: FormData): Promise<InviteResult> {
  const code = String(f.get("code") ?? "");
  const pass = String(f.get("password") ?? "");
  const pass2 = String(f.get("password2") ?? "");
  if (!/^[0-9a-f]{32}$/.test(code)) return { ok: false, message: "Geçersiz davet bağlantısı." };
  if (pass.length < 8) return { ok: false, message: "Şifre en az 8 karakter olmalı." };
  if (pass !== pass2) return { ok: false, message: "Şifreler aynı değil." };
  let admin;
  try { admin = createAdminClient(); } catch { return { ok: false, message: "Sistem ayarı eksik; firmayla iletişime geçin." }; }
  const { data: inv } = await admin.from("sup_portal_users").select("id, email, name, user_id, is_active, invite_expires").eq("invite_code", code).maybeSingle();
  if (!inv || inv.user_id || !inv.is_active || !inv.invite_expires || Date.parse(inv.invite_expires) < Date.now()) return { ok: false, message: "Davetin süresi dolmuş ya da kullanılmış. Firmadan yeni davet isteyin." };
  const { data: created, error } = await admin.auth.admin.createUser({ email: inv.email, password: pass, email_confirm: true, user_metadata: { full_name: inv.name, supplier: true } });
  if (error || !created.user) {
    if (/already|registered|exists/i.test(error?.message ?? "")) return { ok: false, message: "Bu e-posta ile zaten bir hesap var. Giriş yapın (şifrenizi unuttuysanız “Şifremi unuttum”), sonra bu davet bağlantısını tekrar açıp “Hesabıma bağla”ya basın." };
    return { ok: false, message: "Hesap oluşturulamadı, tekrar deneyin." };
  }
  await admin.from("sup_portal_users").update({ user_id: created.user.id, invite_code: null, last_seen_at: new Date().toISOString() }).eq("id", inv.id);
  const supabase = await createClient();
  await supabase.auth.signInWithPassword({ email: inv.email, password: pass });
  redirect("/tedarikci");
}

/** Zaten giriş yapmış kişi daveti kendi hesabına bağlar */
export async function supInviteClaim(f: FormData): Promise<void> {
  const code = String(f.get("code") ?? "");
  const supabase = await createClient();
  const { error } = await supabase.rpc("sup_invite_claim", { p_code: code });
  redirect(error ? `/tedarikci/davet/${code}?hata=1` : "/tedarikci");
}
