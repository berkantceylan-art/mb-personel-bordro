import { cache } from "react";
import { cookies } from "next/headers";
import { isLocale, type Locale } from "./i18n";
import type { PortalAccount } from "./portal-ui";
import { createClient } from "./supabase/server";

export * from "./portal-ui";

/** Portal dili: çerez (kayıt sayfasında seçilen) → varsayılan Türkçe */
export async function portalLocale(account?: { language: Locale } | null): Promise<Locale> {
  if (account && isLocale(account.language)) return account.language;
  const c = (await cookies()).get("portal-dil")?.value;
  return isLocale(c) ? c : "tr";
}

export type PortalContext = {
  user: { id: string; email: string; meta: Record<string, unknown> };
  account: PortalAccount | null;
};

/** Giriş yapmış kullanıcı ve bağlı portal hesabı */
export const portalContext = cache(async (): Promise<PortalContext | null> => {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return null;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: m } = await supabase.from("portal_members").select("account_id").eq("user_id", user.id).limit(1).maybeSingle();
  let account: PortalAccount | null = null;
  if (m?.account_id) {
    const { data } = await supabase.from("portal_accounts").select("*").eq("id", m.account_id).maybeSingle();
    account = (data as PortalAccount | null) ?? null;
  }
  return { user: { id: user.id, email: user.email ?? "", meta: (user.user_metadata ?? {}) as Record<string, unknown> }, account };
});

