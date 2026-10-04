export const LOCALES = ["tr", "en", "fr"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "tr";

export function isLocale(v: string | undefined | null): v is Locale {
  return !!v && (LOCALES as readonly string[]).includes(v);
}

/** Çok dilli alan: {"tr": "...", "en": "...", "fr": "..."} — eksik dilde Türkçeye düşer */
export type I18nText = Partial<Record<Locale, string | null>>;
export function t(v: I18nText | null | undefined, locale: Locale): string {
  if (!v) return "";
  return (v[locale] || v.tr || v.en || v.fr || "").trim();
}

export const LOCALE_NAMES: Record<Locale, string> = { tr: "Türkçe", en: "English", fr: "Français" };

type Dict = {
  meta: { title: string; description: string };
  nav: { products: string; technology: string; quality: string; delivery: string; contact: string; login: string; sendCase: string };
  hero: { title: string; lead: string; chartHint: string; upper: string; lower: string; send: string; login: string };
  products: {
    title: string;
    lead: string;
    groups: { name: string; items: { name: string; note: string }[] }[];
  };
  tech: { title: string; lead: string; steps: { name: string; text: string }[]; materials: string; materialList: string[] };
  delivery: { title: string; lead: string; cols: [string, string, string, string]; rows: [string, string, string, string][]; note: string };
  quality: { title: string; text: string; standards: { code: string; name: string }[] };
  contact: { title: string; phone: string; email: string; address: string };
  footer: { rights: string };
  slides: { title: string };
  days: string[];
};

const tr: Dict = {
  meta: {
    title: "MB Dental — İzmir diş protez laboratuvarı",
    description: "Hekimler için dijital diş protez laboratuvarı: zirkonyum, porselen, implant üstü, hareketli protez ve ortodonti. ISO 13485.",
  },
  nav: { products: "Ürünler", technology: "Teknoloji", quality: "Kalite", delivery: "Teslimat", contact: "İletişim", login: "Giriş", sendCase: "Vaka gönder" },
  hero: {
    title: "Vakanızı dişinden başlatın.",
    lead: "Taramanızı ya da ölçünüzü gönderin; tasarım, üretim ve son kontrol İzmir'deki laboratuvarımızda. Türkiye'deki ve yurtdışındaki hekimlerle kendi dillerinde çalışıyoruz.",
    chartHint: "Bir dişe dokunun, vaka formu o dişle açılsın.",
    upper: "Üst çene",
    lower: "Alt çene",
    send: "Vaka gönder",
    login: "Hekim girişi",
  },
  products: {
    title: "Ürettiklerimiz",
    lead: "Sabit protezlerin tamamını CAD/CAM ile üretiyoruz; ortodonti ayrı bir üretim bölümünde.",
    groups: [
      {
        name: "Sabit protezler",
        items: [
          { name: "Zirkonyum", note: "Full anatomik ya da altyapı, çok katmanlı bloklar" },
          { name: "Porselen", note: "Metal destekli, el işçiliği tabakalama" },
          { name: "Inlay ve onlay", note: "Kompozit ve seramik; CNC ya da 3D baskı" },
          { name: "İmplant üstü", note: "Premill parçadan kişiye özel abutment" },
        ],
      },
      {
        name: "Hareketli protezler",
        items: [
          { name: "Freze ve ataşman", note: "Primer ve sekonder yapılar dijital" },
          { name: "Akrilik ve flexite", note: "Parsiyel, total, esnek protez" },
          { name: "İskelet", note: "Döküm ve CAD/CAM" },
        ],
      },
      {
        name: "Ortodonti",
        items: [
          { name: "Plaklar ve apareyler", note: "Yükseltme ve düzeltme plaklarında uzmanlık" },
          { name: "Gece plakları", note: "Yumuşak, sert, çift katmanlı" },
        ],
      },
    ],
  },
  tech: {
    title: "Dijital iş akışı",
    lead: "Alçı model ya da ağız içi tarama dosyası; her vaka aynı hattan geçer.",
    steps: [
      { name: "Tarama", text: "Modeller 3Shape tarayıcılarla taranır, IOS dosyaları doğrudan alınır." },
      { name: "Tasarım", text: "Tüm indikasyonlar dijital ortamda tasarlanır; onayınıza sunulabilir." },
      { name: "Üretim", text: "CNC işleme ve 3D baskı; premill parçalar için ayrılmış tezgâhlar." },
      { name: "Son kontrol", text: "Her ürün laboratuvardan çıkmadan usta teknisyen onayından geçer." },
    ],
    materials: "İşlediğimiz bloklar",
    materialList: ["Zirkonyum", "CoCr", "Titanyum", "Titanyum premill", "PMMA", "Döküm", "Seramik", "PEEK"],
  },
  delivery: {
    title: "Fransa'dan gönderim takvimi",
    lead: "UPS ile çalışıyoruz: paketiniz gönderdiğiniz gün alınır, ertesi gün İzmir'de.",
    cols: ["Fransa'dan çıkış", "İzmir'e varış", "İzmir'den çıkış", "Fransa'ya varış"],
    rows: [
      ["Pazartesi", "Salı", "Perşembe", "Cuma"],
      ["Salı", "Çarşamba", "Cumartesi", "Pazartesi"],
      ["Çarşamba", "Perşembe", "Cumartesi", "Pazartesi"],
      ["Perşembe", "Cuma", "Cumartesi (kısmen Pazartesi)", "Pazartesi (kısmen Salı)"],
      ["Cuma", "Pazartesi", "Çarşamba", "Perşembe"],
    ],
    note: "Bunlar garanti ettiğimiz en geç sürelerdir. Yurt içi süreler için bizi arayın.",
  },
  quality: {
    title: "Kalite",
    text: "Tüm iş ve üretim süreçlerimizi uluslararası kalite standartlarına uygun yürütüyoruz; kullandığımız malzemeler CE belgeli.",
    standards: [
      { code: "ISO 9001:2015", name: "Kalite yönetim sistemi" },
      { code: "ISO 13485:2016", name: "Tıbbi cihazlar için kalite yönetim sistemi" },
    ],
  },
  contact: { title: "İletişim", phone: "Telefon", email: "E-posta", address: "Adres" },
  footer: { rights: "Tüm hakları saklıdır." },
  slides: { title: "Laboratuvardan" },
  days: [],
};

const en: Dict = {
  meta: {
    title: "MB Dental — Dental laboratory in Izmir",
    description: "Digital dental laboratory for dentists: zirconia, porcelain, implant restorations, removable prosthetics and orthodontics. ISO 13485.",
  },
  nav: { products: "Products", technology: "Technology", quality: "Quality", delivery: "Shipping", contact: "Contact", login: "Sign in", sendCase: "Send a case" },
  hero: {
    title: "Start your case from the tooth.",
    lead: "Send your scan or impression; design, production and final inspection happen in our Izmir laboratory. We work with dentists in their own language.",
    chartHint: "Tap a tooth to open the case form for it.",
    upper: "Upper jaw",
    lower: "Lower jaw",
    send: "Send a case",
    login: "Dentist sign-in",
  },
  products: {
    title: "What we make",
    lead: "All fixed prosthetics are CAD/CAM; orthodontics has its own production department.",
    groups: [
      {
        name: "Fixed prosthetics",
        items: [
          { name: "Zirconia", note: "Full-contour or framework, multilayer blocks" },
          { name: "Porcelain", note: "Porcelain-fused-to-metal, hand layered" },
          { name: "Inlays and onlays", note: "Composite and ceramic; milled or 3D printed" },
          { name: "Implant restorations", note: "Custom abutments from premill blanks" },
        ],
      },
      {
        name: "Removable prosthetics",
        items: [
          { name: "Telescopes and attachments", note: "Primary and secondary structures designed digitally" },
          { name: "Acrylic and flexible", note: "Partial, complete, flexible dentures" },
          { name: "Partial frameworks", note: "Cast and CAD/CAM" },
        ],
      },
      {
        name: "Orthodontics",
        items: [
          { name: "Plates and appliances", note: "Specialised in expansion and correction plates" },
          { name: "Night guards", note: "Soft, hard, dual-layer" },
        ],
      },
    ],
  },
  tech: {
    title: "Digital workflow",
    lead: "Stone model or intraoral scan; every case follows the same line.",
    steps: [
      { name: "Scan", text: "Models are scanned on 3Shape scanners; IOS files are accepted directly." },
      { name: "Design", text: "Every indication is designed digitally and can be sent for your approval." },
      { name: "Production", text: "CNC milling and 3D printing; dedicated machines for premill parts." },
      { name: "Final inspection", text: "Every piece is approved by a master technician before it leaves." },
    ],
    materials: "Blocks we mill",
    materialList: ["Zirconia", "CoCr", "Titanium", "Titanium premill", "PMMA", "Castable", "Ceramic", "PEEK"],
  },
  delivery: {
    title: "Shipping schedule from France",
    lead: "We work with UPS: your parcel is collected the day you send it and reaches Izmir the next day.",
    cols: ["Leaves France", "Arrives Izmir", "Leaves Izmir", "Arrives France"],
    rows: [
      ["Monday", "Tuesday", "Thursday", "Friday"],
      ["Tuesday", "Wednesday", "Saturday", "Monday"],
      ["Wednesday", "Thursday", "Saturday", "Monday"],
      ["Thursday", "Friday", "Saturday (some Monday)", "Monday (some Tuesday)"],
      ["Friday", "Monday", "Wednesday", "Thursday"],
    ],
    note: "These are our guaranteed latest times.",
  },
  quality: {
    title: "Quality",
    text: "All our business and production processes follow international quality standards; all materials are CE certified.",
    standards: [
      { code: "ISO 9001:2015", name: "Quality management system" },
      { code: "ISO 13485:2016", name: "Quality management for medical devices" },
    ],
  },
  contact: { title: "Contact", phone: "Phone", email: "Email", address: "Address" },
  footer: { rights: "All rights reserved." },
  slides: { title: "From the lab" },
  days: [],
};

const fr: Dict = {
  meta: {
    title: "MB Dental — Laboratoire de prothèse dentaire à Izmir",
    description: "Laboratoire de prothèse dentaire numérique pour les praticiens : zircone, céramique, implantologie, prothèse amovible et orthodontie. ISO 13485.",
  },
  nav: { products: "Produits", technology: "Technologie", quality: "Qualité", delivery: "Livraison", contact: "Contact", login: "Connexion", sendCase: "Envoyer un cas" },
  hero: {
    title: "Commencez votre cas par la dent.",
    lead: "Envoyez votre empreinte ou votre scan ; conception, fabrication et contrôle final se font dans notre laboratoire d'Izmir. Nos techniciens vous répondent en français.",
    chartHint: "Touchez une dent pour ouvrir le formulaire de cas.",
    upper: "Maxillaire",
    lower: "Mandibule",
    send: "Envoyer un cas",
    login: "Espace praticien",
  },
  products: {
    title: "Nos réalisations",
    lead: "Toute la prothèse fixe est réalisée en CFAO ; l'orthodontie a son propre atelier.",
    groups: [
      {
        name: "Prothèse fixe",
        items: [
          { name: "Zircone", note: "Monolithique ou armature, blocs multicouches" },
          { name: "Céramo-métallique", note: "Stratification à la main" },
          { name: "Inlays et onlays", note: "Composite et céramique ; usinés ou imprimés" },
          { name: "Implantologie", note: "Piliers sur mesure à partir de pièces premill" },
        ],
      },
      {
        name: "Prothèse amovible",
        items: [
          { name: "Télescopes et attachements", note: "Structures primaires et secondaires en CFAO" },
          { name: "Résine et flexible", note: "Partielle, complète, flexible" },
          { name: "Stellites", note: "Coulée et CFAO" },
        ],
      },
      {
        name: "Orthodontie",
        items: [
          { name: "Plaques et appareils", note: "Spécialistes des plaques d'expansion et de correction" },
          { name: "Gouttières de nuit", note: "Souples, rigides, bi-couches" },
        ],
      },
    ],
  },
  tech: {
    title: "Flux numérique",
    lead: "Modèle en plâtre ou empreinte optique ; chaque cas suit la même chaîne.",
    steps: [
      { name: "Numérisation", text: "Les modèles sont scannés sur scanners 3Shape ; les fichiers IOS sont acceptés directement." },
      { name: "Conception", text: "Toutes les indications sont conçues en numérique et peuvent vous être soumises." },
      { name: "Fabrication", text: "Usinage CNC et impression 3D ; machines dédiées aux pièces premill." },
      { name: "Contrôle final", text: "Chaque pièce est validée par un maître technicien avant expédition." },
    ],
    materials: "Blocs usinés",
    materialList: ["Zircone", "CoCr", "Titane", "Titane premill", "PMMA", "Calcinable", "Céramique", "PEEK"],
  },
  delivery: {
    title: "Délais de livraison depuis la France",
    lead: "Nous travaillons avec UPS : votre colis est enlevé le jour J et nous est livré à J+1.",
    cols: ["Départ France", "Arrivée Izmir", "Départ Izmir", "Arrivée France"],
    rows: [
      ["Lundi", "Mardi", "Jeudi", "Vendredi"],
      ["Mardi", "Mercredi", "Samedi", "Lundi"],
      ["Mercredi", "Jeudi", "Samedi", "Lundi"],
      ["Jeudi", "Vendredi", "Samedi (une partie lundi)", "Lundi (une partie mardi)"],
      ["Vendredi", "Lundi", "Mercredi", "Jeudi"],
    ],
    note: "Ce sont les délais les plus garantis.",
  },
  quality: {
    title: "Qualité",
    text: "Tous nos processus suivent les normes internationales de qualité ; tous nos matériaux sont certifiés CE.",
    standards: [
      { code: "ISO 9001:2015", name: "Système de management de la qualité" },
      { code: "ISO 13485:2016", name: "Qualité des dispositifs médicaux" },
    ],
  },
  contact: { title: "Contact", phone: "Téléphone", email: "E-mail", address: "Adresse" },
  footer: { rights: "Tous droits réservés." },
  slides: { title: "Au laboratoire" },
  days: [],
};

export const DICTS: Record<Locale, Dict> = { tr, en, fr };

export const CONTACT = {
  phone: "0232 241 24 26",
  phoneHref: "tel:+902322412426",
  email: "info@mbdentaire.com",
  address: ["Aşık Veysel Mah. 5821/1 Sokak No:15", "Karabağlar / İzmir"],
};

/** Ürün kategorileri ve ürün sayfalarındaki sabit metinler */
export const PRODUCT_UI: Record<
  Locale,
  {
    categories: Record<"sabit" | "hareketli" | "ortodonti" | "dijital", string>;
    all: string;
    lead: string;
    highlights: string;
    others: string;
    cta: string;
    ctaText: string;
    send: string;
    back: string;
    more: string;
  }
> = {
  tr: {
    categories: { sabit: "Sabit protezler", hareketli: "Hareketli protezler", ortodonti: "Ortodonti", dijital: "Dijital hizmetler" },
    all: "Ürünler",
    lead: "Laboratuvarımızda ürettiğimiz her şey. Bir ürüne tıklayın, üretim sürecini ve malzemeleri görün.",
    highlights: "Öne çıkanlar",
    others: "Aynı gruptan",
    cta: "Bu ürün için vaka gönderin",
    ctaText: "Ölçünüzü ya da ağız içi tarama dosyanızı gönderin; teslim tarihini aynı gün bildirelim.",
    send: "Vaka gönder",
    back: "Tüm ürünler",
    more: "Ayrıntılar",
  },
  en: {
    categories: { sabit: "Fixed prosthetics", hareketli: "Removable prosthetics", ortodonti: "Orthodontics", dijital: "Digital services" },
    all: "Products",
    lead: "Everything we make in our lab. Open a product to see how it is made and which materials we use.",
    highlights: "Highlights",
    others: "In the same group",
    cta: "Send a case for this product",
    ctaText: "Send your impression or intraoral scan; we confirm the delivery date the same day.",
    send: "Send a case",
    back: "All products",
    more: "Details",
  },
  fr: {
    categories: { sabit: "Prothèse fixe", hareketli: "Prothèse amovible", ortodonti: "Orthodontie", dijital: "Services numériques" },
    all: "Produits",
    lead: "Tout ce que nous réalisons au laboratoire. Ouvrez un produit pour voir sa fabrication et les matériaux utilisés.",
    highlights: "Points forts",
    others: "Dans le même groupe",
    cta: "Envoyer un cas pour ce produit",
    ctaText: "Envoyez votre empreinte ou votre scan intra-oral ; nous confirmons la date de livraison le jour même.",
    send: "Envoyer un cas",
    back: "Tous les produits",
    more: "Détails",
  },
};

/** Kurumsal sayfalardaki sabit metinler */
export const PAGE_UI: Record<Locale, { groups: Record<"kurumsal" | "teknoloji" | "kalite" | "diger", string>; related: string; cta: string; ctaText: string; contact: string; send: string; more: string }> = {
  tr: {
    groups: { kurumsal: "Kurumsal", teknoloji: "Teknoloji", kalite: "Kalite", diger: "Bilgi" },
    related: "Bu bölümde",
    cta: "Birlikte çalışalım",
    ctaText: "İlk vakanızı gönderin ya da fiyat listesi isteyin; aynı gün dönüş yapalım.",
    contact: "Bize yazın",
    send: "Vaka gönder",
    more: "Ayrıntılar",
  },
  en: {
    groups: { kurumsal: "Company", teknoloji: "Technology", kalite: "Quality", diger: "Information" },
    related: "In this section",
    cta: "Let's work together",
    ctaText: "Send your first case or ask for our price list; we reply the same day.",
    contact: "Write to us",
    send: "Send a case",
    more: "Details",
  },
  fr: {
    groups: { kurumsal: "Entreprise", teknoloji: "Technologie", kalite: "Qualité", diger: "Informations" },
    related: "Dans cette rubrique",
    cta: "Travaillons ensemble",
    ctaText: "Envoyez votre premier cas ou demandez nos tarifs ; nous répondons le jour même.",
    contact: "Écrivez-nous",
    send: "Envoyer un cas",
    more: "Détails",
  },
};

/** Vaka galerisi metinleri */
export const CASE_UI: Record<Locale, { title: string; lead: string; before: string; after: string; slider: string; teeth: string; product: string; all: string; empty: string; home: string }> = {
  tr: {
    title: "Vakalar",
    lead: "Laboratuvarımızdan çıkan işlerden örnekler. Kaydırıcıyı sürükleyerek öncesini ve sonrasını karşılaştırın.",
    before: "Öncesi",
    after: "Sonrası",
    slider: "Öncesi ve sonrası karşılaştırma",
    teeth: "Diş",
    product: "Ürün",
    all: "Tüm vakalar",
    empty: "Yakında burada örnek vakalar olacak.",
    home: "Laboratuvardan vakalar",
  },
  en: {
    title: "Cases",
    lead: "Examples of work from our laboratory. Drag the slider to compare before and after.",
    before: "Before",
    after: "After",
    slider: "Before and after comparison",
    teeth: "Teeth",
    product: "Product",
    all: "All cases",
    empty: "Case examples are coming soon.",
    home: "Cases from the lab",
  },
  fr: {
    title: "Cas cliniques",
    lead: "Exemples de travaux réalisés dans notre laboratoire. Faites glisser le curseur pour comparer avant et après.",
    before: "Avant",
    after: "Après",
    slider: "Comparaison avant / après",
    teeth: "Dents",
    product: "Produit",
    all: "Tous les cas",
    empty: "Des exemples de cas arrivent bientôt.",
    home: "Cas du laboratoire",
  },
};
