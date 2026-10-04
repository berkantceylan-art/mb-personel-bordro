"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSiteEditor } from "./auth";
import type { FormState } from "@/components/admin/UploadForm";
import { MEDIA_BUCKET } from "./cms";
import { MEDIA_MIME, isMediaPath, type MediaItem } from "./media";
import { mediaUsage } from "./media-server";
import { LOCALES, type I18nText } from "./i18n";
import { createClient } from "./supabase/server";

type Table = "cms_slides" | "cms_announcements" | "cms_products" | "cms_stories";
const LIST_PATH: Record<Table, string> = { cms_slides: "/admin/slaytlar", cms_announcements: "/admin/duyurular", cms_products: "/admin/urunler", cms_stories: "/admin/hikayeler" };

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

function i18n(f: FormData, base: string): I18nText {
  const out: I18nText = {};
  for (const l of LOCALES) {
    const v = str(f, `${base}.${l}`);
    if (v) out[l] = v;
  }
  return out;
}

/** <input type="datetime-local"> değeri İstanbul saatidir (UTC+3, yaz saati yok) */
function istanbul(v: string): string | null {
  if (!v) return null;
  return new Date(`${v.length === 16 ? `${v}:00` : v}+03:00`).toISOString();
}

function safeHref(v: string): string | null {
  if (!v) return null;
  if (v.startsWith("/") && !v.startsWith("//")) return v;
  if (v.startsWith("https://")) return v;
  return null;
}

function back(table: Table, msg: string, kind: "ok" | "hata" = "ok", extra = ""): never {
  redirect(`${LIST_PATH[table]}?${kind}=${encodeURIComponent(msg)}${extra}`);
}

function refresh(table: Table) {
  revalidatePath(LIST_PATH[table]);
  revalidatePath("/admin");
  for (const l of LOCALES) revalidatePath(`/${l}`);
  if (table === "cms_products") revalidatePath("/", "layout"); // ürün sayfaları, anasayfa, sitemap
}

/** Tarayıcının depolamaya yüklediği dosyanın yolu (form alanı: `<ad>__path`) */
/**
 * Tarayıcının depoya yüklediği ya da kütüphaneden seçilen dosyanın yolu (form alanı: `<ad>__path`).
 * Kütüphaneden seçilen dosya başka bir klasörde olabilir; bilinen klasörlerin hepsi kabul edilir.
 */
function uploadedPath(f: FormData, field: string, _folder?: string): string | undefined {
  const v = str(f, `${field}__path`);
  if (!v) return undefined; // değişiklik yok
  if (!isMediaPath(v)) throw new Error("Geçersiz dosya yolu.");
  return v;
}

/** Çoklu dosya alanı (galeri): aynı adla birden fazla yol gelir */
function uploadedPaths(f: FormData, field: string, _folder?: string): string[] {
  const list = [...new Set(f.getAll(`${field}__path`).map((v) => String(v).trim()).filter(Boolean))];
  if (list.some((v) => !isMediaPath(v))) throw new Error("Geçersiz dosya yolu.");
  return list;
}

// ---------------------------------------------------------------------
// Slaytlar
// ---------------------------------------------------------------------
export async function saveSlide(_prev: FormState, form: FormData): Promise<FormState> {
  await requireSiteEditor();
  const id = str(form, "id");
  const supabase = await createClient();
  let image: string | undefined, imageMobile: string | undefined, video: string | undefined;
  try {
    image = uploadedPath(form, "image", "slaytlar");
    imageMobile = uploadedPath(form, "image_mobile", "slaytlar");
    video = uploadedPath(form, "video", "slaytlar");
  } catch (e) {
    return { error: (e as Error).message };
  }
  const row: Record<string, unknown> = {
    placement: str(form, "placement") || "home",
    title: i18n(form, "title"),
    subtitle: i18n(form, "subtitle"),
    button_label: i18n(form, "button_label"),
    button_href: safeHref(str(form, "button_href")),
    is_active: form.get("is_active") === "on",
    starts_at: istanbul(str(form, "starts_at")),
    ends_at: istanbul(str(form, "ends_at")),
  };
  if (form.get("remove_image") === "on") row.image_path = null;
  if (form.get("remove_image_mobile") === "on") row.image_mobile_path = null;
  if (form.get("remove_video") === "on") row.video_path = null;
  if (image !== undefined) row.image_path = image;
  if (imageMobile !== undefined) row.image_mobile_path = imageMobile;
  if (video !== undefined) row.video_path = video;

  if (!(row.title as I18nText).tr) return { error: "Türkçe başlık zorunlu." };
  if (row.starts_at && row.ends_at && (row.ends_at as string) <= (row.starts_at as string))
    return { error: "Bitiş tarihi başlangıçtan sonra olmalı." };

  if (id) {
    const { error } = await supabase.from("cms_slides").update(row).eq("id", id);
    if (error) return { error: `Kaydedilemedi: ${error.message}` };
  } else {
    const { data: last } = await supabase.from("cms_slides").select("sort").order("sort", { ascending: false }).limit(1);
    row.sort = ((last?.[0]?.sort as number | undefined) ?? 0) + 10;
    const { error } = await supabase.from("cms_slides").insert(row);
    if (error) return { error: `Kaydedilemedi: ${error.message}` };
  }
  refresh("cms_slides");
  back("cms_slides", id ? "Slayt güncellendi." : "Slayt eklendi.");
}

// ---------------------------------------------------------------------
// Duyurular
// ---------------------------------------------------------------------
export async function saveAnnouncement(_prev: FormState, form: FormData): Promise<FormState> {
  await requireSiteEditor();
  const id = str(form, "id");
  const supabase = await createClient();
  let image: string | undefined;
  try {
    image = uploadedPath(form, "image", "duyurular");
  } catch (e) {
    return { error: (e as Error).message };
  }
  const kind = str(form, "kind");
  const audience = str(form, "audience");
  const row: Record<string, unknown> = {
    kind: ["banner", "popup", "news"].includes(kind) ? kind : "banner",
    audience: audience === "portal" ? "portal" : "public",
    title: i18n(form, "title"),
    body: i18n(form, "body"),
    link_href: safeHref(str(form, "link_href")),
    priority: Number.parseInt(str(form, "priority") || "0", 10) || 0,
    is_active: form.get("is_active") === "on",
    starts_at: istanbul(str(form, "starts_at")),
    ends_at: istanbul(str(form, "ends_at")),
  };
  if (form.get("remove_image") === "on") row.image_path = null;
  if (image !== undefined) row.image_path = image;
  if (!(row.title as I18nText).tr) return { error: "Türkçe başlık zorunlu." };
  if (row.starts_at && row.ends_at && (row.ends_at as string) <= (row.starts_at as string))
    return { error: "Bitiş tarihi başlangıçtan sonra olmalı." };

  const { error } = id
    ? await supabase.from("cms_announcements").update(row).eq("id", id)
    : await supabase.from("cms_announcements").insert(row);
  if (error) return { error: `Kaydedilemedi: ${error.message}` };
  refresh("cms_announcements");
  back("cms_announcements", id ? "Duyuru güncellendi." : "Duyuru eklendi.");
}

// ---------------------------------------------------------------------
// Ürünler
// ---------------------------------------------------------------------
const CATEGORIES = ["sabit", "hareketli", "ortodonti", "dijital"];

function slugify(v: string): string {
  const map: Record<string, string> = { ç: "c", ğ: "g", ı: "i", İ: "i", ö: "o", ş: "s", ü: "u", é: "e", è: "e", ê: "e", à: "a", â: "a", î: "i", ô: "o", û: "u" };
  return v
    .trim()
    .replace(/[çğıİöşüéèêàâîôû]/gi, (c) => map[c] ?? map[c.toLowerCase()] ?? c)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
}

export async function saveProduct(_prev: FormState, form: FormData): Promise<FormState> {
  await requireSiteEditor();
  const id = str(form, "id");
  const supabase = await createClient();
  let image: string | undefined, added: string[];
  try {
    image = uploadedPath(form, "image", "urunler");
    added = uploadedPaths(form, "gallery", "urunler");
  } catch (e) {
    return { error: (e as Error).message };
  }
  const name = i18n(form, "name");
  if (!name.tr) return { error: "Türkçe ürün adı zorunlu." };
  const slug = slugify(str(form, "slug") || name.tr);
  if (!slug) return { error: "Adres (slug) boş olamaz." };
  const category = str(form, "category");

  const row: Record<string, unknown> = {
    slug,
    category: CATEGORIES.includes(category) ? category : "sabit",
    name,
    summary: i18n(form, "summary"),
    body: i18n(form, "body"),
    highlights: i18n(form, "highlights"),
    seo_title: i18n(form, "seo_title"),
    seo_description: i18n(form, "seo_description"),
    is_active: form.get("is_active") === "on",
  };
  if (form.get("remove_image") === "on") row.image_path = null;
  if (image !== undefined) row.image_path = image;

  // Galeri: mevcutlardan işaretlenenleri çıkar, yenileri sona ekle
  const keep = form.getAll("gallery_keep").map(String);
  const removed = new Set(form.getAll("remove_gallery").map(String));
  row.gallery = [...keep.filter((p) => !removed.has(p)), ...added].slice(0, 24);

  const dup = await supabase.from("cms_products").select("id").eq("slug", slug).neq("id", id || "00000000-0000-0000-0000-000000000000").maybeSingle();
  if (dup.data) return { error: `"${slug}" adresi başka bir üründe kullanılıyor. Farklı bir adres yazın.` };

  if (id) {
    const { error } = await supabase.from("cms_products").update(row).eq("id", id);
    if (error) return { error: `Kaydedilemedi: ${error.message}` };
  } else {
    const { data: last } = await supabase.from("cms_products").select("sort").order("sort", { ascending: false }).limit(1);
    row.sort = ((last?.[0]?.sort as number | undefined) ?? 0) + 10;
    const { error } = await supabase.from("cms_products").insert(row);
    if (error) return { error: `Kaydedilemedi: ${error.message}` };
  }
  refresh("cms_products");
  back("cms_products", id ? "Ürün güncellendi." : "Ürün eklendi.");
}

export async function moveProduct(form: FormData) {
  await requireSiteEditor();
  const supabase = await createClient();
  const id = str(form, "id");
  const dir = str(form, "dir") === "up" ? "up" : "down";
  const { data } = await supabase.from("cms_products").select("id, sort, category").is("deleted_at", null).order("sort");
  const list = (data ?? []) as { id: string; sort: number; category: string }[];
  const me = list.find((r) => r.id === id);
  if (!me) back("cms_products", "Ürün bulunamadı.", "hata");
  const same = list.filter((r) => r.category === me!.category);
  const i = same.findIndex((r) => r.id === id);
  const j = dir === "up" ? i - 1 : i + 1;
  if (j < 0 || j >= same.length) back("cms_products", "Sıra değişmedi.");
  [same[i], same[j]] = [same[j], same[i]];
  // Grubun mevcut sıra değerlerini yeni düzene dağıt (diğer gruplara dokunmaz)
  const slots = same.map((r) => r.sort).sort((a, b) => a - b);
  for (let k = 0; k < same.length; k++) {
    if (same[k].sort !== slots[k]) await supabase.from("cms_products").update({ sort: slots[k] }).eq("id", same[k].id);
  }
  refresh("cms_products");
  back("cms_products", "Sıra güncellendi.");
}

// ---------------------------------------------------------------------
// Hikâyeler
// ---------------------------------------------------------------------
function parseFrames(raw: string): { path: string; caption: I18nText }[] {
  let list: unknown;
  try {
    list = JSON.parse(raw || "[]");
  } catch {
    throw new Error("Kareler okunamadı.");
  }
  if (!Array.isArray(list)) throw new Error("Kareler okunamadı.");
  if (list.length > 30) throw new Error("Bir hikâyede en fazla 30 kare olabilir.");
  return list.map((f) => {
    const path = String((f as { path?: unknown })?.path ?? "");
    if (!isMediaPath(path)) throw new Error("Geçersiz kare dosyası.");
    const cap = ((f as { caption?: unknown })?.caption ?? {}) as Record<string, unknown>;
    const caption: I18nText = {};
    for (const l of LOCALES) {
      const v = typeof cap[l] === "string" ? (cap[l] as string).trim().slice(0, 300) : "";
      if (v) caption[l] = v;
    }
    return { path, caption };
  });
}

export async function saveStory(_prev: FormState, form: FormData): Promise<FormState> {
  await requireSiteEditor();
  const id = str(form, "id");
  const supabase = await createClient();
  let frames: { path: string; caption: I18nText }[], cover: string | undefined;
  try {
    frames = parseFrames(str(form, "frames"));
    cover = uploadedPath(form, "cover");
  } catch (e) {
    return { error: (e as Error).message };
  }
  const title = i18n(form, "title");
  if (!title.tr) return { error: "Türkçe başlık zorunlu." };
  if (frames.length === 0) return { error: "En az bir kare (görsel ya da video) ekleyin." };
  const row: Record<string, unknown> = {
    title,
    frames,
    link_href: safeHref(str(form, "link_href")),
    link_label: i18n(form, "link_label"),
    is_active: form.get("is_active") === "on",
    starts_at: istanbul(str(form, "starts_at")),
    ends_at: istanbul(str(form, "ends_at")),
  };
  if (form.get("remove_cover") === "on") row.cover_path = null;
  if (cover !== undefined) row.cover_path = cover;
  if (row.starts_at && row.ends_at && (row.ends_at as string) <= (row.starts_at as string))
    return { error: "Bitiş tarihi başlangıçtan sonra olmalı." };

  if (id) {
    const { error } = await supabase.from("cms_stories").update(row).eq("id", id);
    if (error) return { error: `Kaydedilemedi: ${error.message}` };
  } else {
    const { data: last } = await supabase.from("cms_stories").select("sort").order("sort", { ascending: false }).limit(1);
    row.sort = ((last?.[0]?.sort as number | undefined) ?? 0) + 10;
    const { error } = await supabase.from("cms_stories").insert(row);
    if (error) return { error: `Kaydedilemedi: ${error.message}` };
  }
  refresh("cms_stories");
  back("cms_stories", id ? "Hikâye güncellendi." : "Hikâye eklendi.");
}

export async function moveStory(form: FormData) {
  await requireSiteEditor();
  const supabase = await createClient();
  const id = str(form, "id");
  const dir = str(form, "dir") === "up" ? "up" : "down";
  const { data } = await supabase.from("cms_stories").select("id, sort").is("deleted_at", null).order("sort");
  const list = (data ?? []) as { id: string; sort: number }[];
  const i = list.findIndex((r) => r.id === id);
  const j = dir === "up" ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= list.length) back("cms_stories", "Sıra değişmedi.");
  const order = list.map((r) => r.id);
  [order[i], order[j]] = [order[j], order[i]];
  for (let k = 0; k < order.length; k++) await supabase.from("cms_stories").update({ sort: (k + 1) * 10 }).eq("id", order[k]);
  refresh("cms_stories");
  back("cms_stories", "Sıra güncellendi.");
}

// ---------------------------------------------------------------------
// Ortak: yayına al / kaldır, çöpe at, geri al, kalıcı sil, sırala
// ---------------------------------------------------------------------
function tableOf(form: FormData): Table {
  const t = str(form, "table");
  if (t !== "cms_slides" && t !== "cms_announcements" && t !== "cms_products" && t !== "cms_stories") throw new Error("Geçersiz tablo");
  return t;
}

export async function setActive(form: FormData) {
  await requireSiteEditor();
  const table = tableOf(form);
  const supabase = await createClient();
  const on = str(form, "on") === "1";
  const { error } = await supabase.from(table).update({ is_active: on }).eq("id", str(form, "id"));
  if (error) back(table, error.message, "hata");
  refresh(table);
  back(table, on ? "Yayına alındı." : "Yayından kaldırıldı (taslak).");
}

export async function moveToTrash(form: FormData) {
  await requireSiteEditor();
  const table = tableOf(form);
  const supabase = await createClient();
  const { error } = await supabase.from(table).update({ deleted_at: new Date().toISOString() }).eq("id", str(form, "id"));
  if (error) back(table, error.message, "hata");
  refresh(table);
  back(table, "Çöp kutusuna taşındı. 30 gün içinde geri alabilirsiniz.");
}

export async function restoreFromTrash(form: FormData) {
  await requireSiteEditor();
  const table = tableOf(form);
  const supabase = await createClient();
  const { error } = await supabase.from(table).update({ deleted_at: null, is_active: false }).eq("id", str(form, "id"));
  if (error) back(table, error.message, "hata", "&durum=cop");
  refresh(table);
  back(table, "Geri alındı. Taslak olarak duruyor; hazır olunca yayına alın.");
}

export async function deleteForever(form: FormData) {
  await requireSiteEditor();
  const table = tableOf(form);
  const supabase = await createClient();
  const id = str(form, "id");
  // Yalnız çöpteki kayıt kalıcı silinebilir
  const { data } = await supabase.from(table).select("*").eq("id", id).not("deleted_at", "is", null).maybeSingle();
  if (!data) back(table, "Kalıcı silmek için kayıt önce çöp kutusunda olmalı.", "hata", "&durum=cop");
  // Dosyalar silinmez: medya kütüphanesinde kalır, başka yerde de kullanılıyor olabilir
  const { error } = await supabase.from(table).delete().eq("id", id);
  if (error) back(table, error.message, "hata", "&durum=cop");
  refresh(table);
  back(table, "Kalıcı olarak silindi.", "ok", "&durum=cop");
}

export async function moveSlide(form: FormData) {
  await requireSiteEditor();
  const supabase = await createClient();
  const id = str(form, "id");
  const dir = str(form, "dir") === "up" ? "up" : "down";
  const { data } = await supabase.from("cms_slides").select("id, sort, placement").is("deleted_at", null).order("sort");
  const list = (data ?? []) as { id: string; sort: number; placement: string }[];
  const me = list.find((r) => r.id === id);
  if (!me) back("cms_slides", "Slayt bulunamadı.", "hata");
  const same = list.filter((r) => r.placement === me!.placement);
  const i = same.findIndex((r) => r.id === id);
  const j = dir === "up" ? i - 1 : i + 1;
  if (j < 0 || j >= same.length) back("cms_slides", "Sıra değişmedi.");
  // Sıraları 10'ar aralıkla yeniden yaz, sonra ikisini değiştir
  const order = same.map((r) => r.id);
  [order[i], order[j]] = [order[j], order[i]];
  for (let k = 0; k < order.length; k++) {
    await supabase.from("cms_slides").update({ sort: (k + 1) * 10 }).eq("id", order[k]);
  }
  refresh("cms_slides");
  back("cms_slides", "Sıra güncellendi.");
}

// ---------------------------------------------------------------------
// Medya kütüphanesi
// ---------------------------------------------------------------------
export type MediaUpload = { path: string; mime: string; size: number; width?: number | null; height?: number | null };

/** Tarayıcı depoya yükledikten sonra çağrılır: dosyayı kütüphaneye kaydeder */
export async function registerMedia(items: MediaUpload[]): Promise<{ error?: string }> {
  await requireSiteEditor();
  const rows = items
    .filter((i) => isMediaPath(i.path) && MEDIA_MIME.includes(i.mime))
    .map((i) => ({
      path: i.path,
      mime: i.mime,
      size: Number.isFinite(i.size) ? Math.round(i.size) : null,
      width: i.width && i.width > 0 ? Math.round(i.width) : null,
      height: i.height && i.height > 0 ? Math.round(i.height) : null,
      title: i.path.split("/").pop()!.replace(/^[0-9a-f-]{37}/, "").replace(/\.[a-z0-9]+$/, "").replace(/[-_]+/g, " ").trim() || null,
    }));
  if (rows.length === 0) return {};
  const supabase = await createClient();
  const { error } = await supabase.from("cms_media").upsert(rows, { onConflict: "path", ignoreDuplicates: true });
  if (error) return { error: error.message };
  revalidatePath("/admin/medya");
  return {};
}

/** Kütüphaneden seçme penceresi için liste */
export async function listMedia(opts: { q?: string; kind?: "image" | "video" | "all"; offset?: number }): Promise<{ items: MediaItem[]; more: boolean }> {
  await requireSiteEditor();
  const supabase = await createClient();
  const limit = 48;
  const offset = Math.max(0, opts.offset ?? 0);
  let q = supabase.from("cms_media").select("*").order("created_at", { ascending: false }).range(offset, offset + limit);
  if (opts.kind === "image") q = q.like("mime", "image/%");
  if (opts.kind === "video") q = q.like("mime", "video/%");
  const term = (opts.q ?? "").trim().slice(0, 60).replace(/[%_,()]/g, " ");
  if (term) q = q.or(`title.ilike.%${term}%,path.ilike.%${term}%`);
  const { data } = await q;
  const items = (data ?? []) as MediaItem[];
  return { items: items.slice(0, limit), more: items.length > limit };
}

export async function updateMedia(_prev: FormState, form: FormData): Promise<FormState> {
  await requireSiteEditor();
  const id = str(form, "id");
  const supabase = await createClient();
  const { error } = await supabase
    .from("cms_media")
    .update({ title: str(form, "title").slice(0, 200) || null, alt: i18n(form, "alt") })
    .eq("id", id);
  if (error) return { error: `Kaydedilemedi: ${error.message}` };
  revalidatePath("/admin/medya");
  redirect(`/admin/medya?ok=${encodeURIComponent("Bilgiler kaydedildi.")}`);
}

export async function deleteMedia(form: FormData) {
  await requireSiteEditor();
  const id = str(form, "id");
  const supabase = await createClient();
  const { data } = await supabase.from("cms_media").select("path").eq("id", id).maybeSingle();
  const path = (data as { path: string } | null)?.path;
  if (!path) redirect(`/admin/medya?hata=${encodeURIComponent("Dosya bulunamadı.")}`);
  const uses = (await mediaUsage()).get(path!) ?? [];
  if (uses.length > 0)
    redirect(`/admin/medya/${id}?hata=${encodeURIComponent(`Bu dosya ${uses.length} yerde kullanılıyor. Önce oralardan kaldırın.`)}`);
  const { error } = await supabase.storage.from(MEDIA_BUCKET).remove([path!]);
  if (error) redirect(`/admin/medya/${id}?hata=${encodeURIComponent(`Silinemedi: ${error.message}`)}`);
  await supabase.from("cms_media").delete().eq("id", id);
  revalidatePath("/admin/medya");
  redirect(`/admin/medya?ok=${encodeURIComponent("Dosya silindi.")}`);
}

// ---------------------------------------------------------------------
// Site ayarları
// ---------------------------------------------------------------------
export async function saveSettings(_prev: FormState, form: FormData): Promise<FormState> {
  await requireSiteEditor();
  const httpsOrEmpty = (k: string) => {
    const v = str(form, k);
    if (v && !/^https:\/\/\S+$/.test(v)) throw new Error(`“${k}” https:// ile başlayan tam bir adres olmalı.`);
    return v;
  };
  let data: Record<string, unknown>;
  try {
    const email = str(form, "email");
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("E-posta adresini kontrol edin.");
    const whatsapp = str(form, "whatsapp").replace(/\D/g, "");
    if (whatsapp && (whatsapp.length < 10 || whatsapp.length > 15)) throw new Error("WhatsApp numarasını ülke koduyla yazın, ör. 905321234567.");
    data = {
      phone: str(form, "phone").slice(0, 40),
      email,
      whatsapp,
      address1: str(form, "address1").slice(0, 160),
      address2: str(form, "address2").slice(0, 160),
      map_url: httpsOrEmpty("map_url"),
      hours: i18n(form, "hours"),
      footer_text: i18n(form, "footer_text"),
      social: {
        instagram: httpsOrEmpty("instagram"),
        facebook: httpsOrEmpty("facebook"),
        linkedin: httpsOrEmpty("linkedin"),
        youtube: httpsOrEmpty("youtube"),
      },
      seo_title: i18n(form, "seo_title"),
      seo_description: i18n(form, "seo_description"),
    };
  } catch (e) {
    return { error: (e as Error).message };
  }
  const supabase = await createClient();
  const { error } = await supabase.from("site_settings").update({ data }).eq("id", 1);
  if (error) return { error: `Kaydedilemedi: ${error.message}` };
  revalidatePath("/", "layout");
  redirect(`/admin/ayarlar?ok=${encodeURIComponent("Ayarlar kaydedildi. Sitede birkaç saniye içinde görünür.")}`);
}

// ---------------------------------------------------------------------
// Gelen kutusu
// ---------------------------------------------------------------------
const MSG_STATUS = ["new", "read", "archived"];

export async function setMessageStatus(form: FormData) {
  await requireSiteEditor();
  const id = str(form, "id");
  const status = str(form, "status");
  const back = str(form, "back") || "/admin/gelen-kutusu";
  if (!MSG_STATUS.includes(status)) redirect(back);
  const supabase = await createClient();
  await supabase.from("cms_messages").update({ status }).eq("id", id);
  revalidatePath("/admin", "layout");
  redirect(back.startsWith("/admin/gelen-kutusu") ? back : "/admin/gelen-kutusu");
}

export async function saveMessageNote(form: FormData) {
  await requireSiteEditor();
  const id = str(form, "id");
  const supabase = await createClient();
  await supabase.from("cms_messages").update({ note: str(form, "note").slice(0, 2000) || null }).eq("id", id);
  revalidatePath(`/admin/gelen-kutusu/${id}`);
  redirect(`/admin/gelen-kutusu/${id}?ok=${encodeURIComponent("Not kaydedildi.")}`);
}

export async function deleteMessage(form: FormData) {
  await requireSiteEditor();
  const id = str(form, "id");
  const supabase = await createClient();
  await supabase.from("cms_messages").delete().eq("id", id);
  revalidatePath("/admin", "layout");
  redirect(`/admin/gelen-kutusu?ok=${encodeURIComponent("Mesaj silindi.")}`);
}
