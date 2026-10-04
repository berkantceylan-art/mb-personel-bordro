"use server";

import { redirect } from "next/navigation";
import { canManageSite, currentUser, homeFor, isPortalUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export type LoginState = { error?: string };

export async function signIn(_: LoginState, form: FormData): Promise<LoginState> {
  const email = String(form.get("email") ?? "").trim();
  const password = String(form.get("password") ?? "");
  const next = String(form.get("sonra") ?? "");
  if (!email || !password) return { error: "E-posta ve şifrenizi girin." };
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return { error: "Sunucu ayarları eksik: Supabase bağlantısı tanımlı değil." };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: "E-posta ya da şifre hatalı." };

  const u = await currentUser();
  const roles = u?.roles ?? [];
  // Admin sayfasına dönülmek isteniyorsa ve yetki varsa oraya
  if (next.startsWith("/admin") && canManageSite(roles)) redirect(next);
  if (!canManageSite(roles) && (await isPortalUser())) redirect(next.startsWith("/portal") ? next : "/portal");
  redirect(homeFor(roles));
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/giris");
}
