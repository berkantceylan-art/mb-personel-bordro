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
  /** Kodla çizilen hazır reklam ("portal-promo" | "portal-tracking" | "visit-booking"); görsel gerekmez */
  builtin?: string | null;
  /** Gösterileceği diller (boş = hepsi) */
  locales?: string[];
  sort: number;
  is_active: boolean;
  starts_at: string | null;
  ends_at: string | null;
  deleted_at: string | null;
  updated_at: string;
};

export type HelpVideo = { id: string; title: I18nText; description: I18nText; target_types: string[]; video_path: string | null; video_url: string | null; poster_path: string | null; sort: number };

/** Yardım sayfası videoları (SQL çalıştırılmadıysa boş) */
export async function publicHelpVideos(): Promise<HelpVideo[]> {
  if (!hasSupabase()) return [];
  try {
    const supabase = await createClient();
    const { data } = await supabase.from("cms_help_videos").select("id, title, description, target_types, video_path, video_url, poster_path, sort").eq("is_active", true).is("deleted_at", null).order("sort").order("created_at");
    return (data ?? []) as HelpVideo[];
  } catch {
    return [];
  }
}

export type AnnouncementKind = "banner" | "popup" | "news" | "update";
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
export async function publicSlides(placement = "home", locale?: string): Promise<Slide[]> {
  if (!hasSupabase()) return [];
  try {
    const supabase = await createClient();
    const { data } = await supabase.from("cms_slides").select("*").eq("placement", placement).is("deleted_at", null).eq("is_active", true).order("sort");
    const now = Date.now();
    return ((data ?? []) as Slide[]).filter(
      (s) => (!s.starts_at || Date.parse(s.starts_at) <= now) && (!s.ends_at || Date.parse(s.ends_at) > now) && (!locale || !s.locales?.length || s.locales.includes(locale)),
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
  lead_days?: number | null;
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

// ---------------------------------------------------------------------
// Gelen kutusu
// ---------------------------------------------------------------------
export type MessageTopic = "general" | "case" | "price" | "partner" | "pickup";
export type Message = {
  id: string;
  topic: MessageTopic;
  status: "new" | "read" | "archived";
  name: string;
  email: string;
  phone: string | null;
  company: string | null;
  country: string | null;
  message: string;
  meta: { tooth?: string; product?: string };
  locale: "tr" | "en" | "fr" | null;
  page: string | null;
  note: string | null;
  created_at: string;
};
export const TOPIC_LABELS: Record<MessageTopic, string> = { general: "Genel", case: "Vaka", price: "Fiyat", partner: "İş birliği", pickup: "Kurye / ölçü alım" };

// ---------------------------------------------------------------------
// Kurumsal sayfalar
// ---------------------------------------------------------------------
export const PAGE_GROUPS = ["kurumsal", "teknoloji", "kalite", "diger"] as const;
export type PageGroup = (typeof PAGE_GROUPS)[number];
export const RESERVED_SLUGS = ["bolge", "malzemeler", "egitim", "belgeler", "urunler", "iletisim", "vaka-gonder", "vakalar", "sss", "ekibimiz", "blog", "kariyer", "teslim-suresi", "yurtdisi", "portal", "admin", "giris", "auth", "api", "sayfa"];

export type SitePage = {
  id: string;
  slug: string;
  group: PageGroup;
  title: I18nText;
  summary: I18nText;
  body: I18nText;
  seo_title: I18nText;
  seo_description: I18nText;
  image_path: string | null;
  gallery: string[];
  show_in_footer: boolean;
  sort: number;
  is_active: boolean;
  deleted_at: string | null;
  updated_at: string;
};

export async function publicPages(): Promise<SitePage[]> {
  if (!hasSupabase()) return [];
  try {
    const supabase = await createClient();
    const { data } = await supabase.from("cms_pages").select("*").is("deleted_at", null).eq("is_active", true).or(`publish_at.is.null,publish_at.lte.${new Date().toISOString()}`).order("sort");
    return ((data ?? []) as SitePage[]).sort((a, b) => PAGE_GROUPS.indexOf(a.group) - PAGE_GROUPS.indexOf(b.group) || a.sort - b.sort);
  } catch {
    return [];
  }
}

export async function publicPage(slug: string): Promise<SitePage | null> {
  if (!hasSupabase() || !/^[a-z0-9-]{1,60}$/.test(slug)) return null;
  try {
    const supabase = await createClient();
    const { data } = await supabase.from("cms_pages").select("*").eq("slug", slug).is("deleted_at", null).eq("is_active", true).maybeSingle();
    return (data as SitePage | null) ?? null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------
// Vaka galerisi
// ---------------------------------------------------------------------
export type CaseItem = {
  id: string;
  title: I18nText;
  description: I18nText;
  product_slug: string | null;
  teeth: string | null;
  before_path: string | null;
  after_path: string | null;
  gallery: string[];
  featured: boolean;
  sort: number;
  is_active: boolean;
  deleted_at: string | null;
  updated_at: string;
};

export async function publicCases(opts: { product?: string; featured?: boolean } = {}): Promise<CaseItem[]> {
  if (!hasSupabase()) return [];
  try {
    const supabase = await createClient();
    let q = supabase.from("cms_cases").select("*").is("deleted_at", null).eq("is_active", true);
    if (opts.product) q = q.eq("product_slug", opts.product);
    if (opts.featured) q = q.eq("featured", true);
    const { data } = await q.order("sort");
    return (data ?? []) as CaseItem[];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------
// Sıkça sorulan sorular
// ---------------------------------------------------------------------
export const FAQ_CATEGORIES = ["genel", "vaka", "dosya", "teslimat", "portal"] as const;
export type FaqCategory = (typeof FAQ_CATEGORIES)[number];
export const FAQ_CATEGORY_LABELS: Record<FaqCategory, Record<"tr" | "en" | "fr", string>> = {
  genel: { tr: "Genel", en: "General", fr: "Général" },
  vaka: { tr: "Vaka gönderme", en: "Sending cases", fr: "Envoi de cas" },
  dosya: { tr: "Dijital dosyalar", en: "Digital files", fr: "Fichiers numériques" },
  teslimat: { tr: "Kargo ve teslimat", en: "Shipping and delivery", fr: "Expédition et livraison" },
  portal: { tr: "Hekim portalı", en: "Doctor portal", fr: "Portail praticien" },
};

export type Faq = {
  id: string;
  question: I18nText;
  answer: I18nText;
  category: FaqCategory;
  sort: number;
  is_active: boolean;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
  product_slug?: string | null;
  area_slug?: string | null;
};

export async function publicFaqs(): Promise<Faq[]> {
  if (!hasSupabase()) return [];
  try {
    const supabase = await createClient();
    const { data } = await supabase.from("cms_faqs").select("*").is("deleted_at", null).eq("is_active", true).order("sort");
    return ((data ?? []) as Faq[]).sort((a, b) => FAQ_CATEGORIES.indexOf(a.category) - FAQ_CATEGORIES.indexOf(b.category) || a.sort - b.sort);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------
// Departmanlar ve çalışanlar
// ---------------------------------------------------------------------
export type Department = {
  id: string;
  name: I18nText;
  description: I18nText;
  image_path: string | null;
  gallery: string[];
  sort: number;
  is_active: boolean;
  deleted_at: string | null;
  updated_at: string;
};

export type TeamMember = {
  id: string;
  name: string;
  role: I18nText;
  bio: I18nText;
  department_id: string | null;
  photo_path: string | null;
  linkedin: string | null;
  employee_id?: string | null;
  sort: number;
  is_active: boolean;
  deleted_at: string | null;
  updated_at: string;
};

export async function publicDepartments(): Promise<Department[]> {
  if (!hasSupabase()) return [];
  try {
    const supabase = await createClient();
    const { data } = await supabase.from("cms_departments").select("*").is("deleted_at", null).eq("is_active", true).order("sort");
    return (data ?? []) as Department[];
  } catch {
    return [];
  }
}

export async function publicTeam(): Promise<TeamMember[]> {
  if (!hasSupabase()) return [];
  try {
    const supabase = await createClient();
    const { data } = await supabase.from("cms_team").select("*").is("deleted_at", null).eq("is_active", true).order("sort");
    return (data ?? []) as TeamMember[];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------
// Blog ve hekim görüşleri
// ---------------------------------------------------------------------
export type PostCategory = "rehber" | "vaka" | "teknoloji" | "haber" | "malzeme";
export type Post = {
  id: string;
  slug: string;
  category: PostCategory;
  title: I18nText;
  summary: I18nText;
  body: I18nText;
  seo_title: I18nText;
  seo_description: I18nText;
  image_path: string | null;
  author: string | null;
  tags: string[];
  publish_at: string;
  is_active: boolean;
  deleted_at: string | null;
  updated_at: string;
};

export async function publicPosts(limit = 100): Promise<Post[]> {
  if (!hasSupabase()) return [];
  try {
    const supabase = await createClient();
    const { data } = await supabase.from("cms_posts").select("*").is("deleted_at", null).eq("is_active", true).lte("publish_at", new Date().toISOString()).order("publish_at", { ascending: false }).limit(limit);
    return (data ?? []) as Post[];
  } catch {
    return [];
  }
}

export async function publicPost(slug: string): Promise<Post | null> {
  if (!hasSupabase() || !/^[a-z0-9-]{1,80}$/.test(slug)) return null;
  try {
    const supabase = await createClient();
    const { data } = await supabase.from("cms_posts").select("*").eq("slug", slug).is("deleted_at", null).eq("is_active", true).lte("publish_at", new Date().toISOString()).maybeSingle();
    return (data as Post | null) ?? null;
  } catch {
    return null;
  }
}

export type Testimonial = { id: string; name: string; role: string | null; city: string | null; country: string | null; quote: I18nText; rating: number | null; photo_path: string | null; consent: boolean; source: string | null; sort: number; is_active: boolean; deleted_at: string | null; updated_at: string };

export async function publicTestimonials(): Promise<Testimonial[]> {
  if (!hasSupabase()) return [];
  try {
    const supabase = await createClient();
    const { data } = await supabase.from("cms_testimonials").select("*").is("deleted_at", null).eq("is_active", true).eq("consent", true).order("sort");
    return (data ?? []) as Testimonial[];
  } catch {
    return [];
  }
}

export type JobPosting = { slug: string; title: string; department: string | null; employment_type: string; experience: string | null; location: string | null; description: string | null; requirements: string | null; closes_on: string | null };

export async function publicJobPostings(): Promise<JobPosting[]> {
  // 1) Veritabanı fonksiyonu (site_growth migration'ı çalıştırıldıysa)
  if (hasSupabase()) {
    try {
      const supabase = await createClient();
      const { data, error } = await supabase.rpc("public_job_postings");
      if (!error) return (data ?? []) as JobPosting[];
    } catch {
      /* ERP'ye düş */
    }
  }
  // 2) ERP'nin herkese açık ilan listesi
  const erp = (process.env.NEXT_PUBLIC_ERP_URL ?? "").replace(/\/+$/, "");
  if (!erp) return [];
  try {
    const res = await fetch(`${erp}/api/ilanlar`, { next: { revalidate: 300 } });
    if (!res.ok) return [];
    const data = (await res.json()) as JobPosting[];
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

/** Ürün ya da bölge sayfasına bağlı soru-cevaplar */
export async function scopedFaqs(scope: { product?: string; area?: string }): Promise<Faq[]> {
  if (!hasSupabase()) return [];
  try {
    const supabase = await createClient();
    let q = supabase.from("cms_faqs").select("*").is("deleted_at", null).eq("is_active", true).order("sort");
    q = scope.product ? q.eq("product_slug", scope.product) : q.eq("area_slug", scope.area ?? "");
    const { data } = await q;
    return (data ?? []) as Faq[];
  } catch {
    return [];
  }
}

export type Area = {
  id: string; slug: string; kind: "city" | "country"; name: I18nText; title: I18nText; intro: I18nText; body: I18nText; delivery: I18nText;
  shipping_days: number | null; is_active: boolean; sort: number; deleted_at: string | null; updated_at: string;
};

/** Şehir / ülke hizmet sayfaları */
export async function publicAreas(): Promise<Area[]> {
  if (!hasSupabase()) return [];
  try {
    const supabase = await createClient();
    const { data } = await supabase.from("cms_areas").select("*").is("deleted_at", null).eq("is_active", true).order("sort");
    return (data ?? []) as Area[];
  } catch {
    return [];
  }
}
export async function publicArea(slug: string): Promise<Area | null> {
  if (!hasSupabase() || !/^[a-z0-9-]{2,60}$/.test(slug)) return null;
  try {
    const supabase = await createClient();
    const { data } = await supabase.from("cms_areas").select("*").eq("slug", slug).is("deleted_at", null).eq("is_active", true).maybeSingle();
    return (data as Area | null) ?? null;
  } catch {
    return null;
  }
}

export type AbTest = { key: string; label: string; variant_a: I18nText; variant_b: I18nText; is_active: boolean; started_at: string | null; winner: "A" | "B" | null };
export async function abTest(key: string): Promise<AbTest | null> {
  if (!hasSupabase()) return null;
  try {
    const supabase = await createClient();
    const { data } = await supabase.from("cms_ab_tests").select("*").eq("key", key).maybeSingle();
    return (data as AbTest | null) ?? null;
  } catch {
    return null;
  }
}

export type Material = { id: string; slug: string; category: string; name: I18nText; summary: I18nText; body: I18nText; indications: I18nText; props: Array<{ k: I18nText; v: string }>; brands: string | null; product_slugs: string[]; image_path: string | null; is_active: boolean; sort: number; deleted_at: string | null; updated_at: string };
export type SiteEvent = { id: string; slug: string; title: I18nText; summary: I18nText; body: I18nText; starts_at: string; duration_min: number; mode: "online" | "onsite" | "hybrid"; location: string | null; join_url: string | null; speaker: string | null; capacity: number | null; image_path: string | null; is_active: boolean; deleted_at: string | null; updated_at: string };
export type Credential = { id: string; kind: "certificate" | "press" | "award" | "membership"; title: I18nText; summary: I18nText; issuer: string | null; issued_on: string | null; valid_until: string | null; url: string | null; image_path: string | null; is_active: boolean; sort: number; deleted_at: string | null };

async function listActive<T>(table: string, order: string, asc = true): Promise<T[]> {
  if (!hasSupabase()) return [];
  try {
    const supabase = await createClient();
    const { data } = await supabase.from(table).select("*").is("deleted_at", null).eq("is_active", true).order(order, { ascending: asc });
    return (data ?? []) as T[];
  } catch {
    return [];
  }
}
export const publicMaterials = () => listActive<Material>("cms_materials", "sort");
export const publicEvents = () => listActive<SiteEvent>("cms_events", "starts_at");
export const publicCredentials = () => listActive<Credential>("cms_credentials", "sort");
export const imgUrl = (p: string | null | undefined) => (p ? (/^https?:\/\//.test(p) ? p : mediaUrl(p)) : null);
