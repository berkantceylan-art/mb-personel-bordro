/**
 * Eski WordPress sitesinin adresleri (TR/EN/FR) → yeni site.
 * Ürün ve kurumsal sayfaları kendi sayfalarını alana kadar anasayfadaki ilgili bölüme gider.
 * Yeni sayfa eklendikçe hedefi güncelleyin.
 */
type Target = { pathname: string; hash?: string };

const SECTIONS: Record<string, string> = {
  products: "urunler",
  technology: "teknoloji",
  quality: "kalite",
  delivery: "teslimat",
  contact: "iletisim",
};

const MAP: Record<string, [string, keyof typeof SECTIONS | null]> = {
  // Türkçe
  "/hakkimizda": ["tr", null],
  "/bizden-haberler": ["tr", null],
  "/sabit-protezler": ["tr", "products"],
  "/porselen": ["tr", "products"],
  "/zirkon": ["tr", "products"],
  "/inlay-onlay": ["tr", "products"],
  "/implant": ["tr", "products"],
  "/hareketli-protezler": ["tr", "products"],
  "/freze-atasman": ["tr", "products"],
  "/akrilik-protezler": ["tr", "products"],
  "/iskelet": ["tr", "products"],
  "/ortodonti": ["tr", "products"],
  "/malzemelerekipmanlar": ["tr", "technology"],
  "/teslimat-sureleri": ["tr", "delivery"],
  "/kalite-yonetim-sistemleri": ["tr", "quality"],
  "/son-kontrol-sureci": ["tr", "quality"],
  "/3d-tasarim": ["tr", "technology"],
  "/3d-baski-modelleme": ["tr", "technology"],
  "/cnc-isleme": ["tr", "technology"],
  "/iletisim": ["tr", "contact"],
  "/klinik": ["tr", null],
  // English
  "/en/about-us": ["en", null],
  "/en/news-from-us": ["en", null],
  "/en/fixed-dentures": ["en", "products"],
  "/en/porcelain": ["en", "products"],
  "/en/zircon": ["en", "products"],
  "/en/inlays-onlays": ["en", "products"],
  "/en/implants": ["en", "products"],
  "/en/removable-dentures": ["en", "products"],
  "/en/telescopes-attachments": ["en", "products"],
  "/en/acrylic-dentures": ["en", "products"],
  "/en/partial-framework": ["en", "products"],
  "/en/orthodontic-appliances": ["en", "products"],
  "/en/materials-equipment": ["en", "technology"],
  "/en/delivery-times": ["en", "delivery"],
  "/en/quality-management-systems": ["en", "quality"],
  "/en/final-control-process": ["en", "quality"],
  "/en/3d-design": ["en", "technology"],
  "/en/3d-printing-modeling": ["en", "technology"],
  "/en/cnc-machining": ["en", "technology"],
  "/en/contact": ["en", "contact"],
  // Français
  "/fr/a-propos-de-nous": ["fr", null],
  "/fr/nouvelles-de-nous": ["fr", null],
  "/fr/protheses-fixes": ["fr", "products"],
  "/fr/porcelaine": ["fr", "products"],
  "/fr/zirkone": ["fr", "products"],
  "/fr/inlays-onlays": ["fr", "products"],
  "/fr/implants": ["fr", "products"],
  "/fr/protheses-amovibles": ["fr", "products"],
  "/fr/telescopes-et-attachements": ["fr", "products"],
  "/fr/protheses-acryliques": ["fr", "products"],
  "/fr/stellites": ["fr", "products"],
  "/fr/orthodontie": ["fr", "products"],
  "/fr/materiel-et-equipement": ["fr", "technology"],
  "/fr/delais-de-livraison": ["fr", "delivery"],
  "/fr/systemes-de-gestion-de-la-qualite": ["fr", "quality"],
  "/fr/processus-de-controle-final": ["fr", "quality"],
  "/fr/conception-3d": ["fr", "technology"],
  "/fr/modelisation-par-impression-3d": ["fr", "technology"],
  "/fr/cnc": ["fr", "technology"],
  "/fr/communication": ["fr", "contact"],
};

export function legacyRedirect(pathname: string): Target | null {
  const key = pathname.replace(/\/+$/, "") || "/";
  // WordPress ürün/sepet kalıntıları
  if (/^\/(shop|cart|checkout|my-account)(\/|$)/.test(key)) return { pathname: "/tr" };
  const hit = MAP[key];
  if (!hit) return null;
  const [locale, section] = hit;
  return { pathname: `/${locale}`, hash: section ? SECTIONS[section] : undefined };
}
