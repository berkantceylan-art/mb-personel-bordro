"use client";

import { registerMedia, type MediaUpload } from "./admin-actions";
import { MEDIA_MAX_BYTES, MEDIA_MIME } from "./media";
import { createClient } from "./supabase/client";

const MEDIA_BUCKET = "site-media";

/** .mov dosyalarında tarayıcı bazen türü boş verir */
function mimeOf(file: File): string {
  if (file.type) return file.type;
  if (/\.mov$/i.test(file.name)) return "video/quicktime";
  return "";
}

async function dimensions(file: File, mime: string): Promise<{ width: number | null; height: number | null }> {
  try {
    if (mime.startsWith("image/") && mime !== "image/svg+xml") {
      const bmp = await createImageBitmap(file);
      const out = { width: bmp.width, height: bmp.height };
      bmp.close();
      return out;
    }
    if (mime.startsWith("video/")) {
      const url = URL.createObjectURL(file);
      try {
        return await new Promise((resolve) => {
          const v = document.createElement("video");
          v.preload = "metadata";
          v.onloadedmetadata = () => resolve({ width: v.videoWidth || null, height: v.videoHeight || null });
          v.onerror = () => resolve({ width: null, height: null });
          v.src = url;
        });
      } finally {
        URL.revokeObjectURL(url);
      }
    }
  } catch {
    /* ölçü alınamazsa boş geçilir */
  }
  return { width: null, height: null };
}

export function checkFile(file: File): string | null {
  const mime = mimeOf(file);
  if (file.size > MEDIA_MAX_BYTES) return `"${file.name}" 50 MB'tan büyük.`;
  if (!MEDIA_MIME.includes(mime)) return `"${file.name}" desteklenmeyen tür. JPG, PNG, WebP, AVIF, GIF, SVG, MP4, WebM ya da MOV yükleyin.`;
  return null;
}

/**
 * Dosyayı tarayıcıdan doğrudan depoya yükler ve kütüphaneye kaydeder.
 * Sunucuya dosyanın kendisi gitmez (Vercel'in istek sınırına takılmaz).
 */
export async function uploadMedia(file: File, folder: string): Promise<MediaUpload> {
  const problem = checkFile(file);
  if (problem) throw new Error(problem);
  const mime = mimeOf(file);
  const safe = file.name.toLowerCase().replace(/[^a-z0-9.\-_]+/g, "-").slice(-80);
  const path = `${folder}/${crypto.randomUUID()}-${safe}`;
  const supabase = createClient();
  const [{ error }, dims] = await Promise.all([
    supabase.storage.from(MEDIA_BUCKET).upload(path, file, { contentType: mime, upsert: false }),
    dimensions(file, mime),
  ]);
  if (error) throw new Error(`"${file.name}" yüklenemedi: ${error.message}`);
  const item: MediaUpload = { path, mime, size: file.size, ...dims };
  // Kütüphane kaydı başarısız olsa da dosya yüklendi; formu durdurmayız
  await registerMedia([item]).catch(() => undefined);
  return item;
}
