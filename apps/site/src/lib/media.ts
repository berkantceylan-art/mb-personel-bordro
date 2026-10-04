import type { I18nText } from "./i18n";

/** Depodaki klasörler: her form kendi klasörüne yükler, kütüphaneden yüklenenler "medya"ya */
export const MEDIA_FOLDERS = ["medya", "slaytlar", "duyurular", "urunler"] as const;

/** Tarayıcının yükleyebileceği türler (depo izinleriyle aynı) */
export const MEDIA_MIME = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/avif",
  "image/gif",
  "image/svg+xml",
  "video/mp4",
  "video/webm",
  "video/quicktime",
];
export const MEDIA_MAX_BYTES = 50 * 1024 * 1024;

export type MediaItem = {
  id: string;
  path: string;
  mime: string | null;
  size: number | null;
  width: number | null;
  height: number | null;
  title: string | null;
  alt: I18nText;
  created_at: string;
  updated_at: string;
};

export type MediaKind = "image" | "video" | "other";

export function mediaKind(mime: string | null | undefined, path = ""): MediaKind {
  if (mime?.startsWith("image/") || /\.(jpe?g|png|webp|avif|gif|svg)$/i.test(path)) return "image";
  if (mime?.startsWith("video/") || /\.(mp4|webm|mov)$/i.test(path)) return "video";
  return "other";
}

/** "urunler/3f2a…-zirkon-kron.jpg" → "zirkon-kron.jpg" */
export function mediaName(path: string): string {
  const file = path.split("/").pop() ?? path;
  return file.replace(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-/, "");
}

export function formatSize(bytes: number | null | undefined): string {
  if (!bytes) return "—";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;
}

/** Depo yolu doğrulaması: bilinen klasör + uuid + güvenli dosya adı */
export function isMediaPath(v: string): boolean {
  return new RegExp(`^(${MEDIA_FOLDERS.join("|")})/[0-9a-f-]{36}-[a-z0-9.\\-_]{1,80}$`).test(v);
}

export type MediaUse = { type: string; label: string; href: string };

/** Herkese açık dosya adresi (istemci tarafında da kullanılabilir) */
export function publicMediaUrl(path: string): string {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  return `${base}/storage/v1/object/public/site-media/${path.split("/").map(encodeURIComponent).join("/")}`;
}
