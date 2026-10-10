"use server";

import { createClient as createStatelessClient } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { canManageSite, currentUser, homeFor, isPortalUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

/** handoff: personel ekranına (bordro uygulaması) geçiş adresi; tarayıcı oraya gider */
export type LoginState = { error?: string; handoff?: string };

/** Bordro uygulamasıyla aynı kural: "@" yoksa PDKS / personel numarası kullanıcı adıdır */
const PERSONNEL_DOMAIN = "personel.mbdental.app";

export async function signIn(_: LoginState, form: FormData): Promise<LoginState> {
  const raw = String(form.get("email") ?? "").trim();
  const password = String(form.get("password") ?? "");
  const next = String(form.get("sonra") ?? "");
  const toStaff = form.get("hedef") === "personel";
  if (!raw || !password) return { error: "E-posta (ya da personel no) ve şifrenizi girin." };
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return { error: "Sunucu ayarları eksik: Supabase bağlantısı tanımlı değil." };
  const email = raw.includes("@") ? raw : `${raw.toLowerCase()}@${PERSONNEL_DOMAIN}`;

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: "E-posta / personel no ya da şifre hatalı." };

  const u = await currentUser();
  const roles = u?.roles ?? [];
  const editor = canManageSite(roles);
  const portal = !editor && (await isPortalUser());
  const erp = process.env.NEXT_PUBLIC_ERP_URL?.replace(/\/+$/, "");
  const staff = roles.some((r) => r !== "site_editor");

  // Personel ekranı: açıkça istendiyse ya da hesabın sitede başka paneli yoksa
  if (erp && staff && (toStaff || (!editor && !portal))) {
    // Bordro uygulaması ayrı alan adında: ona AYRI bir oturum açılır (yenileme
    // anahtarları çakışmasın). Sitede başka işi olmayan personelin site oturumu kapanır.
    const stateless = createStatelessClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const { data, error: e2 } = await stateless.auth.signInWithPassword({ email, password });
    if (!editor && !portal) await supabase.auth.signOut({ scope: "local" });
    if (e2 || !data.session) return { error: "Personel ekranına geçilemedi. Lütfen tekrar deneyin." };
    const hash = new URLSearchParams({ access_token: data.session.access_token, refresh_token: data.session.refresh_token, sonra: "/" });
    return { handoff: `${erp}/auth/aktar#${hash.toString()}` };
  }
  if (toStaff && !staff) {
    if (!editor && !portal) await supabase.auth.signOut({ scope: "local" });
    return { error: "Bu hesaba bağlı bir personel kaydı yok. İK / muhasebe ile iletişime geçin." };
  }

  // Admin sayfasına dönülmek isteniyorsa ve yetki varsa oraya
  if (next.startsWith("/admin") && editor) redirect(next);
  if (portal) redirect(next.startsWith("/portal") ? next : "/portal");
  redirect(homeFor(roles));
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/giris");
}
