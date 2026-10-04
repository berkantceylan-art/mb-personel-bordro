"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSiteEditor } from "./auth";
import type { FormState } from "@/components/admin/UploadForm";
import { MEDIA_BUCKET } from "./cms";
import { LOCALES, type I18nText } from "./i18n";
import { createClient } from "./supabase/server";

type Table = "cms_slides" | "cms_announcements";
const LIST_PATH: Record<Table, string> = { cms_slides: "/admin/slaytlar", cms_announcements: "/admin/duyurular" };

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
}

/** Tarayıcının depolamaya yüklediği dosyanın yolu (form alanı: `<ad>__path`) */
function uploadedPath(f: FormData, field: string, folder: string): string | undefined {
  const v = str(f, `${field}__path`);
  if (!v) return undefined; // değişiklik yok
  if (!new RegExp(`^${folder}/[0-9a-f-]{36}-[a-z0-9.\\-_]{1,80}$`).test(v)) throw new Error("Geçersiz dosya yolu.");
  return v;
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
// Ortak: yayına al / kaldır, çöpe at, geri al, kalıcı sil, sırala
// ---------------------------------------------------------------------
function tableOf(form: FormData): Table {
  const t = str(form, "table");
  if (t !== "cms_slides" && t !== "cms_announcements") throw new Error("Geçersiz tablo");
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
  const paths = ["image_path", "image_mobile_path", "video_path"].map((k) => (data as Record<string, unknown>)[k]).filter((p): p is string => typeof p === "string" && !!p);
  const { error } = await supabase.from(table).delete().eq("id", id);
  if (error) back(table, error.message, "hata", "&durum=cop");
  if (paths.length) await supabase.storage.from(MEDIA_BUCKET).remove(paths);
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
