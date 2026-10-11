"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSession } from "@/lib/session";
import { PERSONNEL_DOMAIN, formatInviteCode } from "@/lib/constants";
import { done, fail } from "@/lib/flash";
import { MODS, usersError } from "@/lib/users";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const UUID = /^[0-9a-f-]{36}$/i;

/** Okunaklı geçici şifre: karışan harf / rakam yok (ör. Kar-4821) */
function tempPassword() {
  const L = "abcdefghjkmnpqrstuvwxyz", U = "ABCDEFGHJKLMNPQRSTUVWXYZ", D = "23456789";
  const b = crypto.getRandomValues(new Uint8Array(8));
  return `${U[b[0]! % U.length]}${L[b[1]! % L.length]}${L[b[2]! % L.length]}-${D[b[3]! % D.length]}${D[b[4]! % D.length]}${D[b[5]! % D.length]}${D[b[6]! % D.length]}`;
}
/** 12 karakterlik davet kodu */
function inviteCode() {
  const a = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from(crypto.getRandomValues(new Uint8Array(12)), (x) => a[x % a.length]).join("");
}
/** Kullanıcı adı: e-posta varsa o, yoksa PDKS no (girişte numara yazılır) */
function loginFor(card: string | null, email: string | null, id: string) {
  if (email && /.+@.+\..+/.test(email)) return email.toLowerCase();
  return `${(card ?? "").replace(/\D/g, "") || id.slice(0, 8)}@${PERSONNEL_DOMAIN}`;
}
const shownLogin = (l: string) => (l.endsWith(`@${PERSONNEL_DOMAIN}`) ? l.split("@")[0]! : l);

function levelsFrom(f: FormData) {
  return Object.fromEntries(MODS.map((m) => [m, Math.min(3, Math.max(0, Number(str(f, `lv_${m}`) || 0)))]));
}

// ---------------- Kullanıcı türleri ----------------

export async function saveUserType(f: FormData) {
  const supabase = await createClient();
  const id = str(f, "id");
  const { error } = await supabase.rpc("user_type_save", {
    p_id: UUID.test(id) ? id : null, p_name: str(f, "name"), p_description: str(f, "description"), p_color: str(f, "color"),
    p_levels: levelsFrom(f), p_scoped: f.get("scoped") === "on", p_site: f.get("site") === "on", p_boss: f.get("boss") === "on", p_flow_role: str(f, "flow_role") || null,
  });
  if (error) await fail(usersError(error.message));
  revalidatePath("/yonetim");
  await done(UUID.test(id) ? "Kullanıcı türü kaydedildi; bu türdeki herkesin yetkisi güncellendi." : `“${str(f, "name")}” türü oluşturuldu.`);
}

export async function deleteUserType(f: FormData) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("user_type_delete", { p_id: str(f, "id") });
  if (error) await fail(usersError(error.message));
  revalidatePath("/yonetim");
  await done("Tür silindi. Bu türdeki kullanıcıların yetkileri olduğu gibi kaldı.");
}

export async function restoreUserTypes() {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("user_types_restore");
  if (error) await fail(usersError(error.message));
  revalidatePath("/yonetim");
  await done(data ? `${data} hazır tür eklendi.` : "Hazır türlerin hepsi zaten var.");
}

// ---------------- Kullanıcılar ----------------

export async function assignUserType(f: FormData) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("user_type_assign", { p_user: str(f, "user_id"), p_type: str(f, "type_id") });
  if (error) await fail(usersError(error.message));
  revalidatePath("/yonetim");
  await done("Kullanıcı türü atandı. Kişi bir sonraki sayfa açışında yeni menüsünü görür.");
}

/** Türden farklı kişiye özel seviyeler: "t" = türün / rolün değeri */
export async function saveUserLevels(f: FormData) {
  const user = str(f, "user_id");
  const levels = Object.fromEntries(MODS.map((m) => { const v = str(f, `lv_${m}`); return [m, v === "t" || v === "" ? null : Math.min(3, Math.max(0, Number(v)))]; }));
  const supabase = await createClient();
  // Türü varsa "türden" seçilen modüller türün değerine döner
  const { data: u } = await supabase.from("memberships").select("user_type_id").eq("user_id", user).maybeSingle();
  if (u?.user_type_id) {
    const { data: t } = await supabase.from("user_types").select("levels").eq("id", u.user_type_id).maybeSingle();
    const tl = (t?.levels ?? {}) as Record<string, number>;
    for (const m of MODS) if (levels[m] === null) levels[m] = tl[m] ?? 0;
  }
  const { error } = await supabase.rpc("set_module_levels", { p_user: user, p_levels: levels });
  if (error) await fail(usersError(error.message));
  revalidatePath("/yonetim");
  await done("Kişiye özel yetkiler kaydedildi.");
}

export async function saveUserScope(f: FormData) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("user_set_scope", {
    p_user: str(f, "user_id"), p_name: str(f, "display_name"), p_all: f.get("all_branches") === "on",
    p_branches: f.getAll("branch_id").map(String).filter((x) => UUID.test(x)), p_departments: f.getAll("department_id").map(String).filter((x) => UUID.test(x)),
  });
  if (error) await fail(usersError(error.message));
  revalidatePath("/yonetim");
  await done("Kapsam kaydedildi.");
}

export async function removeUser(f: FormData) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("user_remove", { p_user: str(f, "user_id") });
  if (error) await fail(usersError(error.message));
  revalidatePath("/yonetim");
  await done("Kullanıcının erişimi kaldırıldı. Personel kaydı duruyor.");
}

// ---------------- Hesap açma ----------------

export type Created = { name: string; login: string; password?: string; code?: string; error?: string };
export type CreateResult = { ok: boolean; message: string; rows: Created[] };

/** Personele (ya da dışarıdan birine) tek ekrandan hesap: şifreli hesap hemen açılır; sunucu anahtarı yoksa davet kodu üretilir */
export async function createAccounts(_: CreateResult | null, f: FormData): Promise<CreateResult> {
  const s = await getSession();
  if ((s.modules.users ?? 0) < 2 && s.role !== "owner") return { ok: false, message: "Hesap açmak için Kullanıcı yönetimi yetkisi gerekir.", rows: [] };
  const supabase = await createClient();
  const mode = str(f, "mode"); // "personel" | "dis"
  const pwMode = str(f, "pw"); // "auto" | "manual" | "invite"
  const manualPw = str(f, "password");
  if (pwMode === "manual" && (manualPw.length < 6 || manualPw.length > 72)) return { ok: false, message: "Şifre 6–72 karakter olmalı.", rows: [] };

  type Want = { employee: string | null; name: string; login: string; type: string };
  const want: Want[] = [];
  if (mode === "dis") {
    const name = str(f, "name"), email = str(f, "email").toLowerCase(), type = str(f, "type_id");
    if (!name || !/.+@.+\..+/.test(email)) return { ok: false, message: "Ad ve geçerli bir e-posta yazın.", rows: [] };
    if (!UUID.test(type)) return { ok: false, message: "Kullanıcı türü seçin.", rows: [] };
    want.push({ employee: null, name, login: email, type });
  } else {
    const ids = f.getAll("employee_id").map(String).filter((x) => UUID.test(x)).slice(0, 100);
    if (!ids.length) return { ok: false, message: "En az bir personel seçin.", rows: [] };
    const { data: list, error } = await supabase.rpc("users_without_account");
    if (error) return { ok: false, message: usersError(error.message), rows: [] };
    const byId = new Map(((list ?? []) as { employee_id: string; name: string; card_no: string | null; email: string | null }[]).map((e) => [e.employee_id, e]));
    for (const id of ids) {
      const e = byId.get(id);
      const type = str(f, `type_${id}`) || str(f, "type_id");
      if (!e) continue;
      if (!UUID.test(type)) return { ok: false, message: `${e.name} için kullanıcı türü seçin.`, rows: [] };
      const custom = str(f, `login_${id}`);
      want.push({ employee: id, name: e.name, login: custom ? (custom.includes("@") ? custom.toLowerCase() : `${custom.replace(/\s/g, "").toLowerCase()}@${PERSONNEL_DOMAIN}`) : loginFor(e.card_no, e.email, id), type });
    }
    if (!want.length) return { ok: false, message: "Seçilen personelin hesabı zaten var.", rows: [] };
  }

  let admin: ReturnType<typeof createAdminClient> | null = null;
  if (pwMode !== "invite") { try { admin = createAdminClient(); } catch { admin = null; } }

  const rows: Created[] = [];
  for (const w of want) {
    if (admin) {
      const password = pwMode === "manual" ? manualPw : tempPassword();
      const c = await admin.auth.admin.createUser({ email: w.login, password, email_confirm: true });
      if (c.error || !c.data.user) {
        rows.push({ name: w.name, login: shownLogin(w.login), error: /registered|exists/i.test(c.error?.message ?? "") ? "Bu kullanıcı adıyla hesap zaten var. Kullanıcı adını değiştirin ya da davet koduyla bağlayın." : /password/i.test(c.error?.message ?? "") ? "Şifre, Supabase şifre kuralına uymuyor." : (c.error?.message ?? "Hesap açılamadı") });
        continue;
      }
      const { error } = await admin.rpc("admin_attach_account", { p_actor: s.userId, p_user: c.data.user.id, p_employee: w.employee, p_type: w.type, p_name: w.name });
      if (error) {
        await admin.auth.admin.deleteUser(c.data.user.id);
        rows.push({ name: w.name, login: shownLogin(w.login), error: usersError(error.message) });
        continue;
      }
      rows.push({ name: w.name, login: shownLogin(w.login), password });
    } else {
      const code = inviteCode();
      const { error } = await supabase.rpc("user_invite_create", { p_type: w.type, p_employee: w.employee, p_name: w.name, p_login: w.login, p_code: code });
      rows.push(error ? { name: w.name, login: shownLogin(w.login), error: usersError(error.message) } : { name: w.name, login: shownLogin(w.login), code: formatInviteCode(code) });
    }
  }
  revalidatePath("/yonetim");
  const okN = rows.filter((r) => !r.error).length;
  const viaCode = rows.some((r) => r.code);
  return {
    ok: okN > 0,
    message: okN === 0 ? "Hesap açılamadı." : viaCode ? `${okN} kişi için davet kodu üretildi${pwMode === "invite" ? "" : " (sunucu hesap anahtarı tanımlı olmadığı için)"}. Kişi uygulamada “Hesap oluştur” deyip kodu girer ve şifresini kendisi belirler.` : `${okN} hesap açıldı. Giriş bilgilerini yazdırıp kişiye verin; ilk girişte şifresini değiştirebilir.`,
    rows,
  };
}

/** Şifre sıfırla: yeni geçici şifre üretir (sunucu anahtarı yoksa sıfırlama kodu) */
export async function resetPassword(_: CreateResult | null, f: FormData): Promise<CreateResult> {
  const user = str(f, "user_id");
  const supabase = await createClient();
  const { data: can } = await supabase.rpc("user_can_manage", { p_target: user });
  if (can !== true) return { ok: false, message: "Bu kullanıcının şifresini sıfırlama yetkiniz yok.", rows: [] };
  const { data: m } = await supabase.rpc("users_overview");
  const u = ((m ?? []) as { user_id: string; display_name: string; email: string | null; employee_id: string | null; role: string; user_type_id: string | null }[]).find((x) => x.user_id === user);
  if (!u?.email) return { ok: false, message: "Kullanıcı bulunamadı.", rows: [] };
  let admin: ReturnType<typeof createAdminClient> | null = null;
  try { admin = createAdminClient(); } catch { admin = null; }
  if (admin) {
    const password = tempPassword();
    const { error } = await admin.auth.admin.updateUserById(user, { password });
    if (error) return { ok: false, message: error.message, rows: [] };
    return { ok: true, message: "Yeni geçici şifre oluşturuldu.", rows: [{ name: u.display_name, login: shownLogin(u.email), password }] };
  }
  // Anahtar yoksa: aynı kullanıcı adına sıfırlama kodu (davet ekranında yeni şifre belirlenir)
  const code = inviteCode();
  const s = await getSession();
  const { error } = await supabase.from("invites").insert({ company_id: s.companyId, code, role: u.role, employee_id: u.employee_id, display_name: u.display_name, login_email: u.email, user_type_id: u.user_type_id });
  if (error) return { ok: false, message: usersError(error.message), rows: [] };
  return { ok: true, message: "Şifre sıfırlama kodu üretildi. Kişi uygulamada “Hesap oluştur” ekranına bu kodu girip yeni şifresini belirler.", rows: [{ name: u.display_name, login: shownLogin(u.email), code: formatInviteCode(code) }] };
}
