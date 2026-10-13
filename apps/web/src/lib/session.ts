import { redirect } from "next/navigation";
import { cache } from "react";
import { createClient } from "./supabase/server";

export type Role = "owner" | "accountant" | "hr" | "branch_manager" | "safety" | "employee" | "site_editor";

export interface Session {
  userId: string;
  email: string | undefined;
  companyId: string;
  companyName: string;
  role: Role;
  /** Patron ekranı yetkisi (memberships.is_boss) */
  boss: boolean;
  /** Web sitesi yönetimi (mbdentaire.com admin): sahip, site editörü ya da memberships.site_access */
  siteAccess: boolean;
  /** Kargo / gümrük / kurye modülü: sahip, muhasebe, İK, şef ya da memberships.logistics_access */
  logistics: boolean;
  /** Modül yetki seviyeleri: 0 yok, 1 görüntüle, 2 düzenle, 3 yönet (bkz. MODULES) */
  modules: Record<string, number>;
}

export const MODULES = ["hr", "attendance", "payroll", "safety", "lab", "finance", "sales", "purchases", "stock", "production", "assets", "expenses", "users"] as const;
export type ModuleKey = (typeof MODULES)[number];

/** Veritabanındaki module_default_level ile aynı kural (fonksiyon henüz yoksa kullanılır) */
export function defaultModuleLevel(role: string, logistics: boolean, m: string): number {
  const T: Record<string, Record<string, number>> = {
    accountant: { finance: 3, sales: 3, purchases: 3, expenses: 3, assets: 3, payroll: 3, stock: 2, hr: 2, attendance: 2, lab: 2, production: 1, safety: 1 },
    branch_manager: { stock: 2, production: 2, hr: 2, attendance: 2, lab: 2, sales: 1, purchases: 1, expenses: 1, assets: 1, safety: 1 },
    hr: { hr: 3, attendance: 3, safety: 3, lab: 2, users: 2, assets: 1, expenses: 1, payroll: 1 },
    safety: { safety: 3, hr: 1, attendance: 1 },
  };
  let lvl = role === "owner" ? 3 : (T[role]?.[m] ?? 0);
  if (logistics && ["stock", "production", "lab"].includes(m)) lvl = Math.max(lvl, 2);
  return lvl;
}

/** Oturumdaki kullanıcı ve şirketi. Şirketi yoksa kurulum sayfasına gönderir. */
export const getSession = cache(async (): Promise<Session> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/giris");

  let { data: m } = await supabase
    .from("memberships")
    .select("company_id, role, is_boss, companies!memberships_company_id_fkey(name)")
    .eq("user_id", user.id)
    .order("created_at")
    .limit(1)
    .maybeSingle();
  if (!m) {
    // is_boss sütunu henüz yoksa (20261104000000_boss.sql çalıştırılmamış) eski sorgu
    const r = await supabase.from("memberships").select("company_id, role, companies!memberships_company_id_fkey(name)").eq("user_id", user.id).order("created_at").limit(1).maybeSingle();
    m = r.data ? { ...r.data, is_boss: false } : null;
  }

  if (!m) {
    // Tedarikçi portal kullanıcısı: ERP'ye değil tedarikçi ekranına
    const { data: sup } = await supabase.from("sup_portal_users").select("id").eq("user_id", user.id).eq("is_active", true).limit(1);
    if (sup?.length) redirect("/tedarikci");
    redirect("/kurulum");
  }
  // site_access sütunu henüz yoksa (20261123000000_single_sign_on.sql çalıştırılmamış) hata yok sayılır
  const flags = await supabase.from("memberships").select("site_access, logistics_access").eq("user_id", user.id).eq("company_id", m.company_id).maybeSingle();
  const sa = (flags.error ? (await supabase.from("memberships").select("site_access").eq("user_id", user.id).eq("company_id", m.company_id).maybeSingle()).data : flags.data) as { site_access?: boolean; logistics_access?: boolean } | null;
  const company = m.companies as unknown as { name: string } | null;
  const { data: lv, error: lvErr } = await supabase.rpc("my_module_levels");
  const modules: Record<string, number> = {};
  for (const k of MODULES) modules[k] = !lvErr && lv && typeof (lv as Record<string, number>)[k] === "number" ? (lv as Record<string, number>)[k]! : defaultModuleLevel(m.role as string, sa?.logistics_access === true, k);
  // Laboratuvar / kargo: kullanıcı türünde "lab" modülü (eski kurulumda rol + bayrak)
  const logistics = (modules.lab ?? 0) >= 1;
  return {
    userId: user.id,
    email: user.email,
    companyId: m.company_id as string,
    companyName: company?.name ?? "",
    role: m.role as Role,
    boss: m.is_boss === true,
    siteAccess: m.role === "owner" || m.role === "site_editor" || sa?.site_access === true,
    logistics,
    modules,
  };
});

export const canManagePay = (r: Role) => r === "owner" || r === "accountant";

/** "2026-10" */
export const currentPeriod = () => {
  const d = new Date(Date.now() + 3 * 3600 * 1000); // İstanbul
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};

export const todayIso = () => new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10);

const MONTHS = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
export const periodLabel = (p: string) => {
  const [y, m] = p.split("-");
  return `${MONTHS[Number(m) - 1]} ${y}`;
};

export const formatDate = (iso: string) => {
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}.${m}.${y}`;
};
