import type { Session } from "@supabase/supabase-js";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { supabase } from "./supabase";

export type Role = "owner" | "accountant" | "hr" | "branch_manager" | "safety" | "employee";
export type Profile = {
  userId: string;
  companyId: string;
  companyName: string;
  role: Role;
  displayName: string;
  employee: { id: string; first_name: string; last_name: string; card_no: string | null; department: string | null; branch: string | null } | null;
};

type Ctx = { session: Session | null; profile: Profile | null; loading: boolean; reload: () => Promise<void>; signOut: () => Promise<void> };
const AuthCtx = createContext<Ctx>({ session: null, profile: null, loading: true, reload: async () => {}, signOut: async () => {} });

export const isManager = (r: Role | undefined) => !!r && r !== "employee";
export const canPay = (r: Role | undefined) => r === "owner" || r === "accountant";
export const canHr = (r: Role | undefined) => r === "owner" || r === "accountant" || r === "hr" || r === "branch_manager";
export const canPublish = (r: Role | undefined) => r === "owner" || r === "hr" || r === "branch_manager";

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  const loadProfile = useCallback(async (s: Session | null) => {
    if (!s) {
      setProfile(null);
      return;
    }
    const uid = s.user.id;
    const [{ data: m }, { data: e }] = await Promise.all([
      supabase.from("memberships").select("company_id, role, display_name, companies(name)").eq("user_id", uid).order("created_at").limit(1).maybeSingle(),
      supabase.from("employees").select("id, first_name, last_name, card_no, departments(name), branches(name)").eq("user_id", uid).maybeSingle(),
    ]);
    if (!m) {
      setProfile(null);
      return;
    }
    const emp = e
      ? {
          id: e.id as string,
          first_name: e.first_name as string,
          last_name: e.last_name as string,
          card_no: (e.card_no as string | null) ?? null,
          department: (e.departments as unknown as { name: string } | null)?.name ?? null,
          branch: (e.branches as unknown as { name: string } | null)?.name ?? null,
        }
      : null;
    setProfile({
      userId: uid,
      companyId: m.company_id as string,
      companyName: (m.companies as unknown as { name: string } | null)?.name ?? "",
      role: m.role as Role,
      displayName: (m.display_name as string | null) ?? (emp ? `${emp.first_name} ${emp.last_name}` : (s.user.email ?? "")),
      employee: emp,
    });
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      setSession(data.session);
      await loadProfile(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "USER_UPDATED") loadProfile(s);
    });
    return () => sub.subscription.unsubscribe();
  }, [loadProfile]);

  const reload = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    await loadProfile(data.session);
  }, [loadProfile]);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setProfile(null);
  }, []);

  return <AuthCtx.Provider value={{ session, profile, loading, reload, signOut }}>{children}</AuthCtx.Provider>;
}

export const useAuth = () => useContext(AuthCtx);
