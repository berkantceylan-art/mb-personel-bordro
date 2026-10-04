import { redirect } from "next/navigation";
import { createClient } from "./supabase/server";

export type SiteRole = "owner" | "accountant" | "hr" | "branch_manager" | "safety" | "employee" | "site_editor";

/** Giriş yapan kullanıcı ve şirket rolleri (bordro/ERP ile aynı memberships tablosu) */
export async function currentUser() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) return null;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase.from("memberships").select("role, company_id").eq("user_id", user.id);
  const roles = (data ?? []).map((m) => m.role as SiteRole);
  return { id: user.id, email: user.email ?? "", roles };
}

export const SITE_EDITOR_ROLES: SiteRole[] = ["owner", "site_editor"];

export function canManageSite(roles: SiteRole[]) {
  return roles.some((r) => SITE_EDITOR_ROLES.includes(r));
}

/** Admin sayfaları ve aksiyonları için: girişsiz → /giris, yetkisiz → /giris?hata=yetki */
export async function requireSiteEditor() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) redirect("/giris?hata=ayar");
  const u = await currentUser();
  if (!u) redirect("/giris?sonra=/admin");
  if (!canManageSite(u.roles)) redirect("/giris?hata=yetki");
  return u;
}

/**
 * Girişten sonra kişinin gideceği yer.
 * Şimdilik: site editörü → /admin, laboratuvar personeli → ERP (bordro uygulaması).
 * Hekim / klinik / aracı kuruluş portalları eklendiğinde buraya bağlanacak.
 */
export function homeFor(roles: SiteRole[]): string {
  if (canManageSite(roles)) return "/admin";
  const erp = process.env.NEXT_PUBLIC_ERP_URL;
  if (roles.length && erp) return erp;
  return "/giris?hata=hesap";
}
