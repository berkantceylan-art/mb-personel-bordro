// Blog, kariyer, teslim süresi, yurtdışı sayfası, hekim görüşleri, çerez bildirimi — TR/EN/FR
import type { Locale } from "./i18n";

export const BLOG_UI: Record<Locale, { nav: string; title: string; lead: string; all: string; read: string; empty: string; by: string; related: string; cats: Record<string, string>; back: string; cta: string; ctaText: string; ctaBtn: string }> = {
  tr: { nav: "Blog", title: "Blog ve hekim rehberi", lead: "Malzeme seçimi, dijital iş akışı ve laboratuvardan vaka hikâyeleri.", all: "Tümü", read: "Devamını oku", empty: "Yakında yeni yazılar burada.", by: "Yazan", related: "Diğer yazılar", cats: { rehber: "Hekim rehberi", vaka: "Vaka hikâyesi", teknoloji: "Teknoloji", malzeme: "Malzeme", haber: "Haber" }, back: "Tüm yazılar", cta: "Vakanızı bize gönderin", ctaText: "Hekim portalından dosyalarınızı yükleyin, aşama aşama takip edin.", ctaBtn: "Vaka gönder" },
  en: { nav: "Blog", title: "Blog & clinician guide", lead: "Material choice, digital workflow and case stories from our lab.", all: "All", read: "Read more", empty: "New articles coming soon.", by: "By", related: "More articles", cats: { rehber: "Clinician guide", vaka: "Case story", teknoloji: "Technology", malzeme: "Materials", haber: "News" }, back: "All articles", cta: "Send us your case", ctaText: "Upload your files through the dentist portal and follow every stage.", ctaBtn: "Send a case" },
  fr: { nav: "Blog", title: "Blog et guide praticien", lead: "Choix des matériaux, flux numérique et cas cliniques de notre laboratoire.", all: "Tous", read: "Lire la suite", empty: "De nouveaux articles arrivent bientôt.", by: "Par", related: "Autres articles", cats: { rehber: "Guide praticien", vaka: "Cas clinique", teknoloji: "Technologie", malzeme: "Matériaux", haber: "Actualités" }, back: "Tous les articles", cta: "Envoyez-nous votre cas", ctaText: "Téléversez vos fichiers via le portail praticien et suivez chaque étape.", ctaBtn: "Envoyer un cas" },
};

export const CAREER_UI: Record<Locale, { nav: string; title: string; lead: string; empty: string; apply: string; type: string; exp: string; loc: string; dept: string; closes: string; general: string; generalText: string }> = {
  tr: { nav: "Kariyer", title: "Kariyer", lead: "Diş teknisyenliği, CAD/CAM ve dijital üretimde ekibimize katılın.", empty: "Şu an açık ilan yok; genel başvurunuzu yine de bırakabilirsiniz.", apply: "Başvur", type: "Çalışma şekli", exp: "Deneyim", loc: "Konum", dept: "Bölüm", closes: "Son başvuru", general: "Genel başvuru", generalText: "Uygun pozisyon açıldığında sizinle iletişime geçelim.", },
  en: { nav: "Careers", title: "Careers", lead: "Join our team in dental technology, CAD/CAM and digital manufacturing.", empty: "No open positions right now; you can still leave a general application.", apply: "Apply", type: "Type", exp: "Experience", loc: "Location", dept: "Department", closes: "Apply by", general: "General application", generalText: "We will contact you when a suitable position opens." },
  fr: { nav: "Carrières", title: "Carrières", lead: "Rejoignez notre équipe en prothèse dentaire, CFAO et fabrication numérique.", empty: "Aucun poste ouvert pour le moment ; vous pouvez déposer une candidature spontanée.", apply: "Postuler", type: "Type de contrat", exp: "Expérience", loc: "Lieu", dept: "Service", closes: "Date limite", general: "Candidature spontanée", generalText: "Nous vous contacterons lorsqu’un poste correspondant s’ouvrira." },
};

export const LEAD_UI: Record<Locale, { nav: string; title: string; lead: string; product: string; start: string; dest: string; dests: Record<string, string>; result: string; ship: string; arrive: string; workdays: string; note: string; none: string; pick: string }> = {
  tr: { nav: "Teslim süresi", title: "Teslim süresi hesaplayıcı", lead: "Ürünü ve ölçünün bize ulaştığı günü seçin; tahmini çıkış ve teslim tarihini görün.", product: "Ürün", start: "Ölçünün laboratuvara ulaştığı gün", dest: "Teslim yeri", dests: { local: "İzmir (kurye)", tr: "Türkiye (kargo)", eu: "Avrupa (DHL / UPS)", other: "Diğer ülkeler" }, result: "Tahmini", ship: "Laboratuvardan çıkış", arrive: "Size teslim", workdays: "iş günü üretim", note: "Hafta sonları, resmî ve dinî bayramlar hesaba katılır. Prova gerektiren işlerde her prova süreyi uzatır. Kesin tarih için iş kaydı sonrası portalda görünen tarihi esas alın.", none: "Ürünlerin üretim süresi henüz girilmedi.", pick: "Ürün seçin" },
  en: { nav: "Turnaround", title: "Turnaround calculator", lead: "Choose the product and the day your impression reaches us to see the estimated shipping and delivery date.", product: "Product", start: "Day the impression reaches the lab", dest: "Delivery to", dests: { local: "Izmir (courier)", tr: "Turkey (cargo)", eu: "Europe (DHL / UPS)", other: "Other countries" }, result: "Estimate", ship: "Leaves the lab", arrive: "Delivered to you", workdays: "working days production", note: "Weekends and Turkish public and religious holidays are taken into account. Each try-in adds time. The date shown in the portal after registration is binding.", none: "Production times have not been entered yet.", pick: "Choose a product" },
  fr: { nav: "Délais", title: "Calculateur de délai", lead: "Choisissez le produit et le jour où l’empreinte nous parvient pour voir la date estimée d’expédition et de livraison.", product: "Produit", start: "Jour de réception de l’empreinte", dest: "Livraison", dests: { local: "Izmir (coursier)", tr: "Turquie (transporteur)", eu: "Europe (DHL / UPS)", other: "Autres pays" }, result: "Estimation", ship: "Départ du laboratoire", arrive: "Livré chez vous", workdays: "jours ouvrés de fabrication", note: "Les week-ends et jours fériés turcs (civils et religieux) sont pris en compte. Chaque essayage allonge le délai. La date affichée dans le portail après enregistrement fait foi.", none: "Les délais de fabrication ne sont pas encore renseignés.", pick: "Choisissez un produit" },
};

export const TESTI_UI: Record<Locale, { title: string; lead: string }> = {
  tr: { title: "Hekimler ne diyor?", lead: "Birlikte çalıştığımız hekimlerin, izinleriyle paylaştığı görüşler." },
  en: { title: "What dentists say", lead: "Feedback shared with permission by the dentists we work with." },
  fr: { title: "L’avis des praticiens", lead: "Témoignages partagés avec leur accord par les praticiens avec qui nous travaillons." },
};

export const COOKIE_UI: Record<Locale, { text: string; more: string; ok: string }> = {
  tr: { text: "Bu site yalnız zorunlu çerezler kullanır; reklam ya da takip çerezi yoktur.", more: "Çerez politikası", ok: "Tamam" },
  en: { text: "This site only uses essential cookies; no advertising or tracking cookies.", more: "Cookie policy", ok: "OK" },
  fr: { text: "Ce site n’utilise que des cookies essentiels ; aucun cookie publicitaire ou de traçage.", more: "Politique des cookies", ok: "D’accord" },
};

/** Türkiye resmî ve dinî tatilleri (dinî bayramlar yaklaşık; her yıl başında Diyanet takvimiyle kontrol edin; arifeler tam gün sayıldı) */
export const TR_HOLIDAYS = new Set([
  // 2026
  "2026-01-01", "2026-03-19", "2026-03-20", "2026-03-21", "2026-03-22", "2026-04-23", "2026-05-01", "2026-05-19",
  "2026-05-26", "2026-05-27", "2026-05-28", "2026-05-29", "2026-05-30", "2026-07-15", "2026-08-30", "2026-10-28", "2026-10-29",
  // 2027
  "2027-01-01", "2027-03-08", "2027-03-09", "2027-03-10", "2027-03-11", "2027-04-23", "2027-05-01", "2027-05-15", "2027-05-16",
  "2027-05-17", "2027-05-18", "2027-05-19", "2027-07-15", "2027-08-30", "2027-10-28", "2027-10-29",
]);

/** Teslim yerine göre taşıma süresi (iş günü) */
export const TRANSIT_DAYS: Record<string, number> = { local: 0, tr: 1, eu: 2, other: 4 };
