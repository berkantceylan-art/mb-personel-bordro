import { cache } from "react";
import type { StoryView } from "@/components/Stories";
import { mediaUrl, publicStories } from "./cms";
import { t, type Locale } from "./i18n";
import { mediaKind } from "./media";

export const STORY_LABELS: Record<Locale, { title: string; close: string; prev: string; next: string; mute: string; unmute: string; pause: string; play: string; open: string; dismiss: string; badge: string }> = {
  tr: { title: "Hikâyeler", close: "Kapat", prev: "Önceki", next: "Sonraki", mute: "Sesi kapat", unmute: "Sesi aç", pause: "Duraklat", play: "Oynat", open: "Hikâyeyi izle", dismiss: "Hikâye penceresini gizle", badge: "Yeni" },
  en: { title: "Stories", close: "Close", prev: "Previous", next: "Next", mute: "Mute", unmute: "Unmute", pause: "Pause", play: "Play", open: "Watch story", dismiss: "Hide story window", badge: "New" },
  fr: { title: "Stories", close: "Fermer", prev: "Précédent", next: "Suivant", mute: "Couper le son", unmute: "Activer le son", pause: "Pause", play: "Lecture", open: "Voir la story", dismiss: "Masquer la fenêtre des stories", badge: "Nouveau" },
};

// ---------------------------------------------------------------------
// Instagram (isteğe bağlı): INSTAGRAM_ACCESS_TOKEN + INSTAGRAM_USER_ID
// Instagram işletme / içerik üreticisi hesabı ve Meta Graph API anahtarı gerekir.
// ---------------------------------------------------------------------
type IgMedia = { id: string; media_type: "IMAGE" | "VIDEO" | "CAROUSEL_ALBUM"; media_url?: string; thumbnail_url?: string; permalink?: string; caption?: string; timestamp?: string };

export const instagramEnabled = () => !!(process.env.INSTAGRAM_ACCESS_TOKEN && process.env.INSTAGRAM_USER_ID);

async function ig(path: string, fields: string, limit: number): Promise<IgMedia[]> {
  if (!instagramEnabled()) return [];
  const url = `https://graph.facebook.com/v21.0/${process.env.INSTAGRAM_USER_ID}/${path}?fields=${fields}&limit=${limit}&access_token=${process.env.INSTAGRAM_ACCESS_TOKEN}`;
  try {
    const res = await fetch(url, { next: { revalidate: 900 }, signal: AbortSignal.timeout(6000) });
    if (!res.ok) return [];
    const j = (await res.json()) as { data?: IgMedia[] };
    return (j.data ?? []).filter((m) => m.media_url || m.thumbnail_url);
  } catch {
    return [];
  }
}

/** Son 24 saatin Instagram hikâyeleri → tek bir "Instagram" hikâyesi */
export async function instagramStory(locale: Locale, profileUrl: string): Promise<StoryView | null> {
  const items = await ig("stories", "id,media_type,media_url,thumbnail_url,permalink,timestamp", 20);
  if (!items.length) return null;
  const frames = items.map((m) => ({ url: m.media_url ?? m.thumbnail_url ?? "", kind: m.media_type === "VIDEO" ? ("video" as const) : ("image" as const), caption: "" }));
  return {
    id: "instagram",
    version: items.map((m) => m.id).join(","),
    title: "Instagram",
    cover: items[0].thumbnail_url ?? (items[0].media_type === "VIDEO" ? null : items[0].media_url ?? null),
    coverIsVideo: !items[0].thumbnail_url && items[0].media_type === "VIDEO",
    frames,
    link: profileUrl ? { href: profileUrl, label: locale === "tr" ? "Instagram'da takip et" : locale === "fr" ? "Suivre sur Instagram" : "Follow on Instagram" } : null,
  };
}

/** Son Instagram gönderileri (anasayfa şeridi) */
export async function instagramPosts(limit = 8): Promise<{ id: string; image: string; href: string; caption: string; video: boolean }[]> {
  const items = await ig("media", "id,media_type,media_url,thumbnail_url,permalink,caption", limit);
  return items.map((m) => ({
    id: m.id,
    image: m.media_type === "VIDEO" ? (m.thumbnail_url ?? "") : (m.media_url ?? ""),
    href: m.permalink ?? "",
    caption: (m.caption ?? "").slice(0, 140),
    video: m.media_type === "VIDEO",
  })).filter((m) => m.image && m.href);
}

/** Sitedeki hikâyeler: admin'den eklenenler + (varsa) Instagram hikâyeleri */
export const storyViews = cache(async (locale: Locale, instagramUrl = ""): Promise<StoryView[]> => {
  const [rows, igStory] = await Promise.all([publicStories(), instagramStory(locale, instagramUrl)]);
  const own: StoryView[] = rows.map((s) => {
    const first = s.frames[0]?.path ?? null;
    const coverPath = s.cover_path ?? first;
    const label = t(s.link_label, locale);
    return {
      id: s.id,
      version: s.updated_at,
      title: t(s.title, locale),
      cover: mediaUrl(coverPath),
      coverIsVideo: !s.cover_path && !!first && mediaKind(null, first) === "video",
      frames: s.frames.map((f) => ({
        url: mediaUrl(f.path) ?? "",
        kind: mediaKind(null, f.path) === "video" ? ("video" as const) : ("image" as const),
        caption: t(f.caption, locale),
      })),
      link: s.link_href && label ? { href: s.link_href, label } : null,
    };
  });
  return igStory ? [igStory, ...own] : own;
});
