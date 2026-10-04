/**
 * Eski WordPress sitesinin adresleri (TR/EN/FR) → yeni site.
 * Ürünler kendi sayfalarına gider; kurumsal sayfalar kendi sayfalarını alana kadar anasayfadaki ilgili bölüme.
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
  "/fr/materiel-et-equipement": ["fr", "technology"],
  "/fr/delais-de-livraison": ["fr", "delivery"],
  "/fr/systemes-de-gestion-de-la-qualite": ["fr", "quality"],
  "/fr/processus-de-controle-final": ["fr", "quality"],
  "/fr/conception-3d": ["fr", "technology"],
  "/fr/modelisation-par-impression-3d": ["fr", "technology"],
  "/fr/cnc": ["fr", "technology"],
  "/fr/communication": ["fr", "contact"],
};

/** Ürün sayfaları → yeni ürün sayfası; ürün grubu sayfaları → ürün listesindeki grup */
const PRODUCTS: Record<string, [string, string]> = {
  "/porselen": ["tr", "/urunler/porselen"],
  "/zirkon": ["tr", "/urunler/zirkonyum"],
  "/inlay-onlay": ["tr", "/urunler/inlay-onlay"],
  "/implant": ["tr", "/urunler/implant"],
  "/freze-atasman": ["tr", "/urunler/freze-atasman"],
  "/akrilik-protezler": ["tr", "/urunler/akrilik-protez"],
  "/iskelet": ["tr", "/urunler/iskelet"],
  "/ortodonti": ["tr", "/urunler/ortodonti"],
  "/en/porcelain": ["en", "/urunler/porselen"],
  "/en/zircon": ["en", "/urunler/zirkonyum"],
  "/en/inlays-onlays": ["en", "/urunler/inlay-onlay"],
  "/en/implants": ["en", "/urunler/implant"],
  "/en/telescopes-attachments": ["en", "/urunler/freze-atasman"],
  "/en/acrylic-dentures": ["en", "/urunler/akrilik-protez"],
  "/en/partial-framework": ["en", "/urunler/iskelet"],
  "/en/orthodontic-appliances": ["en", "/urunler/ortodonti"],
  "/fr/porcelaine": ["fr", "/urunler/porselen"],
  "/fr/zirkone": ["fr", "/urunler/zirkonyum"],
  "/fr/inlays-onlays": ["fr", "/urunler/inlay-onlay"],
  "/fr/implants": ["fr", "/urunler/implant"],
  "/fr/telescopes-et-attachements": ["fr", "/urunler/freze-atasman"],
  "/fr/protheses-acryliques": ["fr", "/urunler/akrilik-protez"],
  "/fr/stellites": ["fr", "/urunler/iskelet"],
  "/fr/orthodontie": ["fr", "/urunler/ortodonti"],
  "/sabit-protezler": ["tr", "/urunler#sabit"],
  "/hareketli-protezler": ["tr", "/urunler#hareketli"],
  "/en/fixed-dentures": ["en", "/urunler#sabit"],
  "/en/removable-dentures": ["en", "/urunler#hareketli"],
  "/fr/protheses-fixes": ["fr", "/urunler#sabit"],
  "/fr/protheses-amovibles": ["fr", "/urunler#hareketli"],
};

export function legacyRedirect(pathname: string): Target | null {
  const key = pathname.replace(/\/+$/, "") || "/";
  // WordPress ürün/sepet kalıntıları
  if (/^\/(shop|cart|checkout|my-account)(\/|$)/.test(key)) return { pathname: "/tr" };
  const product = PRODUCTS[key];
  if (product) {
    const [locale, rest] = product;
    const [path, hash] = rest.split("#");
    return { pathname: `/${locale}${path}`, hash };
  }
  const hit = MAP[key];
  if (!hit) return null;
  const [locale, section] = hit;
  return { pathname: `/${locale}`, hash: section ? SECTIONS[section] : undefined };
}
