import { cache } from "react";
import { hasSupabase } from "./cms";
import { normalizeSchedule, type Schedule } from "./hours";
import { CONTACT, type I18nText } from "./i18n";
import { createClient } from "./supabase/server";

/** Admin › Site ayarları'ndan yönetilen bilgiler (site_settings.data) */
export type SiteSettings = {
  phone: string;
  email: string;
  whatsapp: string; // yalnız rakam, ülke koduyla: 905321234567
  address1: string;
  address2: string;
  map_url: string;
  hours: I18nText;
  footer_text: I18nText;
  social: { instagram: string; facebook: string; linkedin: string; youtube: string; tiktok: string; x: string };
  seo_title: I18nText;
  seo_description: I18nText;
  /** Pazartesi→Pazar, "" kapalı ya da "09:00-18:00" */
  schedule: Schedule;
  /** Haritada aranacak adres (boşsa adres satırları kullanılır) */
  map_query: string;
  /** Sitede canlı destek sekmesi gösterilsin mi */
  chat_enabled: boolean;
  /** Anasayfa "Rakamlarla" şeridi (en fazla 4) */
  stats: { value: string; label: I18nText }[];
  /** Google Search Console doğrulama kodu (meta etiketi içeriği) */
  google_verification: string;
  /** Yapay zekâ asistanı: kapalı / yalnız mesai dışı / ekip cevap verene kadar her zaman */
  ai_assistant: "off" | "offline" | "always";
};

export const DEFAULT_SETTINGS: SiteSettings = {
  phone: CONTACT.phone,
  email: CONTACT.email,
  whatsapp: "",
  address1: CONTACT.address[0],
  address2: CONTACT.address[1],
  map_url: "",
  hours: {},
  footer_text: {},
  social: { instagram: "", facebook: "", linkedin: "", youtube: "", tiktok: "", x: "" },
  seo_title: {},
  seo_description: {},
  schedule: ["", "", "", "", "", "", ""],
  map_query: "",
  chat_enabled: true,
  stats: [],
  google_verification: "",
  ai_assistant: "offline",
};

const str = (v: unknown, max = 300) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const i18n = (v: unknown): I18nText => {
  if (!v || typeof v !== "object") return {};
  const o = v as Record<string, unknown>;
  const out: I18nText = {};
  for (const l of ["tr", "en", "fr"] as const) if (str(o[l], 2000)) out[l] = str(o[l], 2000);
  return out;
};
const url = (v: unknown) => {
  const s = str(v, 500);
  return /^https:\/\/[^\s]+$/.test(s) ? s : "";
};

/** Veritabanından gelen ham değeri güvenli ayar nesnesine çevirir (eksikler varsayılanla dolar) */
export function normalizeSettings(raw: unknown): SiteSettings {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const social = (o.social && typeof o.social === "object" ? o.social : {}) as Record<string, unknown>;
  return {
    phone: str(o.phone, 40) || DEFAULT_SETTINGS.phone,
    email: /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(str(o.email, 200)) ? str(o.email, 200) : DEFAULT_SETTINGS.email,
    whatsapp: str(o.whatsapp, 20).replace(/\D/g, ""),
    address1: str(o.address1, 160) || (o.address1 === undefined ? DEFAULT_SETTINGS.address1 : ""),
    address2: str(o.address2, 160) || (o.address2 === undefined ? DEFAULT_SETTINGS.address2 : ""),
    map_url: url(o.map_url),
    hours: i18n(o.hours),
    footer_text: i18n(o.footer_text),
    social: {
      instagram: url(social.instagram),
      facebook: url(social.facebook),
      linkedin: url(social.linkedin),
      youtube: url(social.youtube),
      tiktok: url(social.tiktok),
      x: url(social.x),
    },
    seo_title: i18n(o.seo_title),
    seo_description: i18n(o.seo_description),
    schedule: normalizeSchedule(o.schedule),
    map_query: str(o.map_query, 200),
    chat_enabled: o.chat_enabled !== false,
    ai_assistant: o.ai_assistant === "off" || o.ai_assistant === "always" ? o.ai_assistant : "offline",
    google_verification: str(o.google_verification, 100).replace(/[^A-Za-z0-9_-]/g, ""),
    stats: (Array.isArray(o.stats) ? o.stats : [])
      .map((x) => {
        const r = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
        return { value: str(r.value, 16), label: i18n(r.label) };
      })
      .filter((x) => x.value && Object.keys(x.label).length)
      .slice(0, 4),
  };
}

/** Google Haritalar gömme adresi (API anahtarı gerektirmez) */
export function mapEmbedUrl(st: SiteSettings, locale = "tr"): string | null {
  const q = st.map_query || [st.address1, st.address2].filter(Boolean).join(", ");
  if (!q) return null;
  return `https://www.google.com/maps?q=${encodeURIComponent(q)}&hl=${locale}&z=16&output=embed`;
}

/** Yol tarifi bağlantısı */
export function directionsUrl(st: SiteSettings): string | null {
  const q = st.map_query || [st.address1, st.address2].filter(Boolean).join(", ");
  if (!q) return st.map_url || null;
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(q)}`;
}

/** Telefon numarasından tel: bağlantısı (Türkiye varsayılan) */
export function telHref(phone: string): string {
  let d = phone.replace(/[^\d+]/g, "");
  if (d.startsWith("+")) return `tel:${d}`;
  d = d.replace(/^0/, "");
  return `tel:+90${d}`;
}

export const getSettings = cache(async (): Promise<SiteSettings> => {
  if (!hasSupabase()) return DEFAULT_SETTINGS;
  try {
    const supabase = await createClient();
    const { data } = await supabase.from("site_settings").select("data").eq("id", 1).maybeSingle();
    return normalizeSettings((data as { data?: unknown } | null)?.data);
  } catch {
    return DEFAULT_SETTINGS;
  }
});
