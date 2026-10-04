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
}

/** Oturumdaki kullanıcı ve şirketi. Şirketi yoksa kurulum sayfasına gönderir. */
export const getSession = cache(async (): Promise<Session> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/giris");

  const { data: m } = await supabase
    .from("memberships")
    .select("company_id, role, companies(name)")
    .eq("user_id", user.id)
    .order("created_at")
    .limit(1)
    .maybeSingle();

  if (!m) redirect("/kurulum");
  const company = m.companies as unknown as { name: string } | null;
  return {
    userId: user.id,
    email: user.email,
    companyId: m.company_id as string,
    companyName: company?.name ?? "",
    role: m.role as Role,
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
