import "react-native-url-polyfill/auto";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";
import { AppState, Platform } from "react-native";

export const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? "";
const ANON = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? "";

export const supabase = createClient(SUPABASE_URL || "https://invalid.supabase.co", ANON || "missing", {
  auth: {
    storage: Platform.OS === "web" ? undefined : AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

/** Web uygulamasının adresi (davetle hesap oluşturma servisi) */
export const WEB_URL = (process.env.EXPO_PUBLIC_WEB_URL ?? "https://mb-personel-bordro.vercel.app").replace(/\/$/, "");

export const configured = Boolean(SUPABASE_URL && ANON);

// Uygulama ön plandayken oturum yenilensin
AppState.addEventListener("change", (state) => {
  if (state === "active") supabase.auth.startAutoRefresh();
  else supabase.auth.stopAutoRefresh();
});

/** Personel kullanıcı adları bu alan adına çevrilir (web ile aynı) */
export const PERSONNEL_DOMAIN = "personel.mbdental.app";
export const toLogin = (v: string) => (v.includes("@") ? v.trim() : `${v.trim().toLowerCase()}@${PERSONNEL_DOMAIN}`);
