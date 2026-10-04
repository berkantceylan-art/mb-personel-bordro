import type { I18nText } from "./i18n";
import { createClient } from "./supabase/server";

export type Slide = {
  id: string;
  placement: string;
  title: I18nText;
  subtitle: I18nText;
  button_label: I18nText;
  button_href: string | null;
  image_path: string | null;
  image_mobile_path: string | null;
  video_path: string | null;
  sort: number;
  is_active: boolean;
  starts_at: string | null;
  ends_at: string | null;
  deleted_at: string | null;
  updated_at: string;
};

export type AnnouncementKind = "banner" | "popup" | "news";
export type Audience = "public" | "portal";

export type Announcement = {
  id: string;
  kind: AnnouncementKind;
  audience: Audience;
  title: I18nText;
  body: I18nText;
  link_href: string | null;
  image_path: string | null;
  priority: number;
  is_active: boolean;
  starts_at: string | null;
  ends_at: string | null;
  deleted_at: string | null;
  updated_at: string;
};

export const MEDIA_BUCKET = "site-media";

export function hasSupabase(): boolean {
  return !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
}

export function mediaUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) return null;
  return `${base}/storage/v1/object/public/${MEDIA_BUCKET}/${path.split("/").map(encodeURIComponent).join("/")}`;
}

/** Sitede yayında olan slaytlar (RLS zaten tarih/aktiflik filtreler; yine de sıralar) */
export async function publicSlides(placement = "home"): Promise<Slide[]> {
  if (!hasSupabase()) return [];
  try {
    const supabase = await createClient();
    const { data } = await supabase.from("cms_slides").select("*").eq("placement", placement).is("deleted_at", null).eq("is_active", true).order("sort");
    const now = Date.now();
    return ((data ?? []) as Slide[]).filter(
      (s) => (!s.starts_at || Date.parse(s.starts_at) <= now) && (!s.ends_at || Date.parse(s.ends_at) > now),
    );
  } catch {
    return [];
  }
}

export async function publicAnnouncements(kind?: AnnouncementKind): Promise<Announcement[]> {
  if (!hasSupabase()) return [];
  try {
    const supabase = await createClient();
    let q = supabase.from("cms_announcements").select("*").eq("audience", "public").is("deleted_at", null).eq("is_active", true);
    if (kind) q = q.eq("kind", kind);
    const { data } = await q.order("priority", { ascending: false }).order("updated_at", { ascending: false });
    const now = Date.now();
    return ((data ?? []) as Announcement[]).filter(
      (a) => (!a.starts_at || Date.parse(a.starts_at) <= now) && (!a.ends_at || Date.parse(a.ends_at) > now),
    );
  } catch {
    return [];
  }
}

/** Bir kaydın şu anki yayın durumu (admin listelerinde rozet için) */
export function liveState(r: { is_active: boolean; starts_at: string | null; ends_at: string | null; deleted_at: string | null }):
  | "trash"
  | "draft"
  | "scheduled"
  | "expired"
  | "live" {
  if (r.deleted_at) return "trash";
  if (!r.is_active) return "draft";
  const now = Date.now();
  if (r.starts_at && Date.parse(r.starts_at) > now) return "scheduled";
  if (r.ends_at && Date.parse(r.ends_at) <= now) return "expired";
  return "live";
}

// ---------------------------------------------------------------------
// Ürünler
// ---------------------------------------------------------------------
export const PRODUCT_CATEGORIES = ["sabit", "hareketli", "ortodonti", "dijital"] as const;
export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number];

export type Product = {
  id: string;
  slug: string;
  category: ProductCategory;
  name: I18nText;
  summary: I18nText;
  body: I18nText;
  highlights: I18nText;
  seo_title: I18nText;
  seo_description: I18nText;
  image_path: string | null;
  gallery: string[];
  sort: number;
  is_active: boolean;
  deleted_at: string | null;
  updated_at: string;
};

/** Ürünlerde tarih aralığı yok; rozet için ortak durum hesabına uyarlar */
export const productState = (p: Product) => liveState({ ...p, starts_at: null, ends_at: null });

export async function publicProducts(): Promise<Product[]> {
  if (!hasSupabase()) return [];
  try {
    const supabase = await createClient();
    const { data } = await supabase.from("cms_products").select("*").is("deleted_at", null).eq("is_active", true).order("sort");
    const rows = (data ?? []) as Product[];
    return rows.sort((a, b) => PRODUCT_CATEGORIES.indexOf(a.category) - PRODUCT_CATEGORIES.indexOf(b.category) || a.sort - b.sort);
  } catch {
    return [];
  }
}

export async function publicProduct(slug: string): Promise<Product | null> {
  if (!hasSupabase() || !/^[a-z0-9-]{1,60}$/.test(slug)) return null;
  try {
    const supabase = await createClient();
    const { data } = await supabase.from("cms_products").select("*").eq("slug", slug).is("deleted_at", null).eq("is_active", true).maybeSingle();
    return (data as Product | null) ?? null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------
// Hikâyeler
// ---------------------------------------------------------------------
export type StoryFrame = { path: string; caption?: I18nText };

export type Story = {
  id: string;
  title: I18nText;
  cover_path: string | null;
  frames: StoryFrame[];
  link_href: string | null;
  link_label: I18nText;
  sort: number;
  is_active: boolean;
  starts_at: string | null;
  ends_at: string | null;
  deleted_at: string | null;
  updated_at: string;
};

export async function publicStories(): Promise<Story[]> {
  if (!hasSupabase()) return [];
  try {
    const supabase = await createClient();
    const { data } = await supabase.from("cms_stories").select("*").is("deleted_at", null).eq("is_active", true).order("sort");
    const now = Date.now();
    return ((data ?? []) as Story[]).filter(
      (s) => s.frames.length > 0 && (!s.starts_at || Date.parse(s.starts_at) <= now) && (!s.ends_at || Date.parse(s.ends_at) > now),
    );
  } catch {
    return [];
  }
}
