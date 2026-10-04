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
  "/bizden-haberler": ["tr", null],
  "/teslimat-sureleri": ["tr", "delivery"],
  "/klinik": ["tr", null],
  // English
  "/en/news-from-us": ["en", null],
  "/en/delivery-times": ["en", "delivery"],
  // Français
  "/fr/nouvelles-de-nous": ["fr", null],
  "/fr/delais-de-livraison": ["fr", "delivery"],
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
  "/iletisim": ["tr", "/iletisim"],
  "/en/contact": ["en", "/iletisim"],
  "/fr/communication": ["fr", "/iletisim"],
  "/hakkimizda": ["tr", "/hakkimizda"],
  "/3d-tasarim": ["tr", "/3d-tasarim"],
  "/cnc-isleme": ["tr", "/cnc-isleme"],
  "/3d-baski-modelleme": ["tr", "/3d-baski"],
  "/malzemelerekipmanlar": ["tr", "/hakkimizda"],
  "/kalite-yonetim-sistemleri": ["tr", "/kalite"],
  "/son-kontrol-sureci": ["tr", "/kalite"],
  "/en/about-us": ["en", "/hakkimizda"],
  "/en/3d-design": ["en", "/3d-tasarim"],
  "/en/cnc-machining": ["en", "/cnc-isleme"],
  "/en/3d-printing-modeling": ["en", "/3d-baski"],
  "/en/materials-equipment": ["en", "/hakkimizda"],
  "/en/quality-management-systems": ["en", "/kalite"],
  "/en/final-control-process": ["en", "/kalite"],
  "/fr/a-propos-de-nous": ["fr", "/hakkimizda"],
  "/fr/conception-3d": ["fr", "/3d-tasarim"],
  "/fr/cnc": ["fr", "/cnc-isleme"],
  "/fr/modelisation-par-impression-3d": ["fr", "/3d-baski"],
  "/fr/materiel-et-equipement": ["fr", "/hakkimizda"],
  "/fr/systemes-de-gestion-de-la-qualite": ["fr", "/kalite"],
  "/fr/processus-de-controle-final": ["fr", "/kalite"],
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
