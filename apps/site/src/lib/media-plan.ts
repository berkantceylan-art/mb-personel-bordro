import { t, type I18nText } from "./i18n";
import { mediaName, type MediaItem } from "./media";
import { createClient } from "./supabase/server";

/**
 * Eski siteden gelen görselleri (medya kütüphanesinde) içeriklere otomatik yerleştirme planı.
 * Eşleştirme dosya adına göredir (eski sitenin medya envanteri: medya-listesi.csv).
 * Varsayılan olarak yalnız BOŞ alanlar doldurulur; dolu alanlar korunur.
 */

type Rule = { image?: string[]; gallery?: string[] };

const PRODUCTS: Record<string, Rule> = {
  zirkonyum: { image: ["zirkon1", "zirkon-1", "zirkon"], gallery: ["zir1", "zir2", "zir3", "zirkon-1", "zirkon"] },
  porselen: { image: ["porselen1", "porselen-1", "porselen"], gallery: ["bi-1", "bi-2", "bi-3", "porselen-1", "porselen"] },
  "inlay-onlay": { image: ["inlay1", "inlay"], gallery: ["in1", "in2", "in3", "inlay"] },
  implant: { image: ["implant1", "implant", "imp0"], gallery: ["imp1", "imp2", "imp3", "imp0", "implant"] },
  "freze-atasman": { image: ["freze", "freeze"], gallery: ["bi-1-1", "bi-2-1", "bi-3-1", "freeze"] },
  "akrilik-protez": { image: ["akrilik-1", "akrilik"], gallery: ["akr2", "akr3", "akr4", "akrilik"] },
  iskelet: { image: ["iskelet-1", "iskelet"], gallery: ["isk2", "isk3", "isk4", "iskelet"] },
  ortodonti: { image: ["ortodonti1", "ortodonti", "ortodonti2"], gallery: ["ort2", "ort3", "ort4", "orto", "ortodonti2"] },
};

const PAGES: Record<string, Rule> = {
  hakkimizda: { image: ["hakkimizda", "hakk"], gallery: ["hak1", "hak2", "hak3", "hak4", "hakkimizda2"] },
  "3d-tasarim": { image: ["3dtasarim", "3d"], gallery: ["3d", "3d1", "3d2", "3d3", "3d-anasayfa1"] },
  "cnc-isleme": { image: ["cnc", "cnc-anasayfa2"], gallery: ["cnc1", "cnc2", "cnc3", "cnc-anasayfa1"] },
  "3d-baski": { image: ["3dbaski", "3db"], gallery: ["3db", "3db-1", "3dd", "3dform"] },
  kalite: { image: ["kalite-yonetim", "son-kontrol"], gallery: ["son-kontrol", "takip"] },
};

/** Departmanlar Türkçe adlarındaki anahtar kelimeyle eşleşir */
const DEPARTMENTS: { match: RegExp; rule: Rule }[] = [
  { match: /tasar|cad/i, rule: { image: ["3d-anasayfa2", "3dtasarim", "3d"], gallery: ["3d1", "3d2", "3d3", "3d-anasayfa1"] } },
  { match: /cnc|baskı|baski|cam/i, rule: { image: ["cnc-anasayfa2", "cnc", "3dbaski"], gallery: ["cnc1", "cnc2", "cnc3", "3db-1", "3dd", "cnc-anasayfa1"] } },
  { match: /porselen|estetik|seramik/i, rule: { image: ["porselen-1", "porselen1"], gallery: ["bi-1", "bi-2", "bi-3"] } },
  { match: /kalite|sevkiyat|kontrol/i, rule: { image: ["son-kontrol", "kalite-yonetim"], gallery: ["takip", "teslimat-sureleri"] } },
];

const SLIDES = ["anasayfa2a", "anasayfa3a", "anasayfa4a", "anasayfa5a", "anasayfa6a", "anasayfa7a"];
const STORY_VIDEOS = ["img_9836", "img_9840", "img_9843"];

export type PlanRow = {
  key: string; // "products:<id>:image" gibi
  group: "Ürünler" | "Sayfalar" | "Departmanlar" | "Slaytlar" | "Hikâyeler";
  label: string;
  field: "Kapak" | "Galeri" | "Yeni slayt" | "Yeni hikâye";
  current: string[];
  proposed: string[];
  filled: boolean; // alan zaten dolu mu
};

/** Dosya adından karşılaştırma anahtarı: uuid öneki, uzantı, boyut ekleri atılır */
export function stemOf(path: string): string {
  return mediaName(path)
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/, "")
    .replace(/-(scaled|rotated|e\d{10,})$/, "")
    .replace(/-\d{2,4}x\d{2,4}$/, "");
}

function buildIndex(items: MediaItem[]) {
  const idx = new Map<string, MediaItem>();
  for (const m of items) {
    const s = stemOf(m.path);
    const prev = idx.get(s);
    const area = (x: MediaItem) => (x.width ?? 0) * (x.height ?? 0) || (x.size ?? 0);
    if (!prev || area(m) > area(prev)) idx.set(s, m);
  }
  return idx;
}

const isImage = (m: MediaItem) => (m.mime ? m.mime.startsWith("image/") : /\.(jpe?g|png|webp|gif|avif)$/i.test(m.path));
const isVideo = (m: MediaItem) => (m.mime ? m.mime.startsWith("video/") : /\.(mp4|webm|mov)$/i.test(m.path));

export async function buildMediaPlan(): Promise<{ rows: PlanRow[]; libraryCount: number; unmatched: string[] }> {
  const supabase = await createClient();
  const all: MediaItem[] = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await supabase.from("cms_media").select("*").range(from, from + 999);
    all.push(...((data ?? []) as MediaItem[]));
    if (!data || data.length < 1000) break;
  }
  const images = buildIndex(all.filter(isImage));
  const videos = buildIndex(all.filter(isVideo));
  const used = new Set<string>();
  const pick = (stems: string[] | undefined, one: boolean): string[] => {
    const out: string[] = [];
    for (const s of stems ?? []) {
      const m = images.get(s);
      if (m && !out.includes(m.path)) {
        out.push(m.path);
        if (one) break;
      }
    }
    out.forEach((p) => used.add(p));
    return out;
  };

  const rows: PlanRow[] = [];
  const add = (r: Omit<PlanRow, "filled">) => {
    if (r.proposed.length) rows.push({ ...r, filled: r.current.length > 0 });
  };

  const [{ data: products }, { data: pages }, { data: deps }, { data: slides }, { data: stories }] = await Promise.all([
    supabase.from("cms_products").select("id, slug, name, image_path, gallery").is("deleted_at", null),
    supabase.from("cms_pages").select("id, slug, title, image_path, gallery").is("deleted_at", null),
    supabase.from("cms_departments").select("id, name, image_path, gallery").is("deleted_at", null),
    supabase.from("cms_slides").select("id, image_path").is("deleted_at", null),
    supabase.from("cms_stories").select("id").is("deleted_at", null),
  ]);

  type Row = { id: string; slug?: string; name?: I18nText; title?: I18nText; image_path: string | null; gallery: string[] | null };
  for (const p of (products ?? []) as Row[]) {
    const rule = PRODUCTS[p.slug ?? ""];
    if (!rule) continue;
    const label = t(p.name, "tr");
    add({ key: `cms_products:${p.id}:image`, group: "Ürünler", label, field: "Kapak", current: p.image_path ? [p.image_path] : [], proposed: pick(rule.image, true) });
    add({ key: `cms_products:${p.id}:gallery`, group: "Ürünler", label, field: "Galeri", current: p.gallery ?? [], proposed: pick(rule.gallery, false) });
  }
  for (const p of (pages ?? []) as Row[]) {
    const rule = PAGES[p.slug ?? ""];
    if (!rule) continue;
    const label = t(p.title, "tr");
    add({ key: `cms_pages:${p.id}:image`, group: "Sayfalar", label, field: "Kapak", current: p.image_path ? [p.image_path] : [], proposed: pick(rule.image, true) });
    add({ key: `cms_pages:${p.id}:gallery`, group: "Sayfalar", label, field: "Galeri", current: p.gallery ?? [], proposed: pick(rule.gallery, false) });
  }
  for (const d of (deps ?? []) as Row[]) {
    const label = t(d.name, "tr");
    const rule = DEPARTMENTS.find((x) => x.match.test(label))?.rule;
    if (!rule) continue;
    add({ key: `cms_departments:${d.id}:image`, group: "Departmanlar", label, field: "Kapak", current: d.image_path ? [d.image_path] : [], proposed: pick(rule.image, true) });
    add({ key: `cms_departments:${d.id}:gallery`, group: "Departmanlar", label, field: "Galeri", current: d.gallery ?? [], proposed: pick(rule.gallery, false) });
  }
  const slidePaths = pick(SLIDES, false);
  const slideHasImage = ((slides ?? []) as { image_path: string | null }[]).some((s) => s.image_path);
  add({ key: "cms_slides:new:slides", group: "Slaytlar", label: "Anasayfa slaytları", field: "Yeni slayt", current: slideHasImage ? ["(mevcut slaytlar)"] : [], proposed: slidePaths });
  const storyVideos = STORY_VIDEOS.map((s) => videos.get(s)?.path).filter((p): p is string => !!p);
  add({ key: "cms_stories:new:story", group: "Hikâyeler", label: "Laboratuvarımızdan", field: "Yeni hikâye", current: (stories ?? []).length ? ["(mevcut hikâyeler)"] : [], proposed: storyVideos });

  const usedStems = new Set([...used].map(stemOf));
  const unmatched = all.filter((m) => isImage(m) && !usedStems.has(stemOf(m.path))).map((m) => m.path);
  return { rows, libraryCount: all.length, unmatched };
}
