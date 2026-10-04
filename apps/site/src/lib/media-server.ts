import { t, type I18nText } from "./i18n";
import type { MediaUse } from "./media";
import { createClient } from "./supabase/server";

type Row = Record<string, unknown> & { id: string; title?: I18nText; name?: I18nText; deleted_at: string | null };

/**
 * Hangi dosya nerede kullanılıyor: yol → kullanım listesi.
 * Tablolar küçük olduğu için tek seferde okunur.
 */
export async function mediaUsage(): Promise<Map<string, MediaUse[]>> {
  const supabase = await createClient();
  const [slides, anns, products, stories] = await Promise.all([
    supabase.from("cms_slides").select("id, title, image_path, image_mobile_path, video_path, deleted_at"),
    supabase.from("cms_announcements").select("id, title, image_path, deleted_at"),
    supabase.from("cms_products").select("id, name, image_path, gallery, deleted_at"),
    supabase.from("cms_stories").select("id, title, cover_path, frames, deleted_at"),
  ]);
  const map = new Map<string, MediaUse[]>();
  const add = (path: unknown, use: MediaUse) => {
    if (typeof path !== "string" || !path) return;
    const list = map.get(path) ?? [];
    list.push(use);
    map.set(path, list);
  };
  const trash = (r: Row) => (r.deleted_at ? " (çöpte)" : "");
  for (const r of (slides.data ?? []) as Row[]) {
    const use = { type: "Slayt", label: (t(r.title, "tr") || "(başlıksız)") + trash(r), href: `/admin/slaytlar/${r.id}` };
    add(r.image_path, use);
    add(r.image_mobile_path, use);
    add(r.video_path, use);
  }
  for (const r of (anns.data ?? []) as Row[]) {
    add(r.image_path, { type: "Duyuru", label: (t(r.title, "tr") || "(başlıksız)") + trash(r), href: `/admin/duyurular/${r.id}` });
  }
  for (const r of (products.data ?? []) as Row[]) {
    const use = { type: "Ürün", label: (t(r.name, "tr") || "(adsız)") + trash(r), href: `/admin/urunler/${r.id}` };
    add(r.image_path, use);
    for (const g of (r.gallery as string[] | null) ?? []) add(g, use);
  }
  for (const r of (stories.data ?? []) as Row[]) {
    const use = { type: "Hikâye", label: (t(r.title, "tr") || "(başlıksız)") + trash(r), href: `/admin/hikayeler/${r.id}` };
    add(r.cover_path, use);
    for (const f of (r.frames as { path?: string }[] | null) ?? []) add(f?.path, use);
  }
  return map;
}
