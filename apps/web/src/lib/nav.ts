/** site: yalnız web sitesi yönetim yetkisi olana; raw: Next bağlantısı değil, düz adres (sunucu yönlendirmesi) */
export type Item = { label: string; href: string; desc?: string; roles?: string[]; site?: boolean; logistics?: boolean; raw?: boolean };
const MANAGERS = ["owner", "accountant", "hr", "branch_manager", "safety"];
const PAY = ["owner", "accountant"];
const HR = ["owner", "hr", "branch_manager"];

const HRM = ["owner", "accountant", "hr", "branch_manager"];

/** Modül grupları: her grup bir ERP modülü; kullanıcı yalnız yetkili olduğu öğeleri görür */
export type Group = { group: string; slug: string; items: Item[] };
export const NAV: Group[] = [
  {
    group: "Genel", slug: "genel",
    items: [
      { label: "Gösterge Paneli", href: "/", roles: MANAGERS },
      { label: "Patron ekranı", href: "/patron", roles: ["owner", "accountant"] },
      { label: "Bildirimler", href: "/bildirimler" },
      { label: "Duyurular", href: "/duyurular" },
      { label: "Mesajlar", href: "/mesajlar" },
      { label: "Talepler", href: "/talepler", roles: [...new Set([...PAY, ...HR])] },
      { label: "İK asistanı", href: "/asistan" },
    ],
  },
  {
    group: "Benim sayfam", slug: "benim",
    items: [
      { label: "Benim sayfam", href: "/benim", roles: ["employee"] },
      { label: "Avans iste", href: "/benim/avans", roles: ["employee"] },
      { label: "İzin", href: "/benim/izin", roles: ["employee"] },
      { label: "Bordrolarım", href: "/benim/bordro", roles: ["employee"] },
      { label: "Hesap hareketlerim", href: "/benim/hareketler", roles: ["employee"] },
      { label: "Puantajım", href: "/benim/puantaj", roles: ["employee"] },
      { label: "Takvimim", href: "/benim/takvim", roles: ["employee"] },
      { label: "Özlük bilgilerim", href: "/benim/ozluk", roles: ["employee"] },
      { label: "Belgelerim", href: "/benim/belgeler", roles: ["employee"] },
      { label: "Zimmetim", href: "/benim/zimmet", roles: ["employee"] },
      { label: "İmzalarım", href: "/benim/imza", roles: ["employee"] },
      { label: "BES", href: "/benim/bes", roles: ["employee"] },
      { label: "İcra ve nafaka", href: "/benim/icra", roles: ["employee"] },
      { label: "Uzaktan eğitim", href: "/benim/egitim", roles: ["employee"] },
      { label: "İş güvenliği", href: "/benim/isg", roles: ["employee"] },
      { label: "Sağlık", href: "/benim/saglik", roles: ["employee"] },
      { label: "İlk günlerim", href: "/benim/ilk-gunlerim", roles: ["employee"] },
      { label: "Performansım", href: "/benim/performans", roles: ["employee"] },
      { label: "Hedef ve becerilerim", href: "/benim/hedefler", roles: ["employee"] },
      { label: "İş ilanları", href: "/benim/ilanlar", roles: ["employee"] },
      { label: "Bana gelen yazılar", href: "/benim/yazilar", roles: ["employee"] },
      { label: "Kişisel verilerim (KVKK)", href: "/benim/kvkk", roles: ["employee"] },
      { label: "Ayarlar", href: "/benim/ayarlar", roles: ["employee"] },
    ],
  },
  {
    group: "İnsan kaynakları", slug: "insan-kaynaklari",
    items: [
      { label: "Personel", href: "/personel", roles: MANAGERS },
      { label: "İşe alım ve ilanlar", href: "/ise-alim", roles: HRM },
      { label: "Uyum süreci", href: "/uyum", roles: HRM },
      { label: "Performans", href: "/performans", roles: HRM },
      { label: "Yetkinlik ve hedefler", href: "/yetkinlik", roles: HRM },
      { label: "Organizasyon", href: "/organizasyon", roles: MANAGERS },
    ],
  },
  {
    group: "Puantaj ve izin", slug: "puantaj-izin",
    items: [
      { label: "Puantaj", href: "/puantaj", roles: MANAGERS },
      { label: "Vardiyalar", href: "/vardiyalar", roles: MANAGERS },
      { label: "Yıllık izin", href: "/yillik-izin", roles: HRM },
      { label: "İzin kayıtları", href: "/izin", roles: MANAGERS },
      { label: "Fazla mesai", href: "/fazla-mesai", roles: MANAGERS },
      { label: "Mesai yemeği", href: "/yemek", roles: HRM },
    ],
  },
  {
    group: "Muhasebe ve bordro", slug: "muhasebe-bordro",
    items: [
      { label: "Ay sonu", href: "/ay-sonu", roles: PAY },
      { label: "Bordro", href: "/bordro", roles: PAY },
      { label: "Dönemler", href: "/donemler", roles: PAY },
      { label: "Avans ve ödemeler", href: "/odemeler/yeni", roles: PAY },
      { label: "Zamlar", href: "/zamlar", roles: PAY },
      { label: "BES", href: "/bes", roles: PAY },
      { label: "İcra ve nafaka", href: "/icra", roles: PAY },
      { label: "SGK işlemleri", href: "/sgk", roles: ["owner", "accountant", "hr"] },
    ],
  },
  {
    group: "Cari", slug: "cari",
    items: [
      { label: "Cari hesaplar", href: "/isler/cari", logistics: true, desc: "Hekim bakiyeleri, tahsilat ve ekstre" },
      { label: "Hekim / hastane kartları", href: "/isler/hekimler", logistics: true },
    ],
  },
  {
    group: "Laboratuvar / üretim", slug: "laboratuvar",
    items: [
      { label: "İş kayıt", href: "/isler/yeni", logistics: true, desc: "Yeni iş: hekim, hasta, diş şeması, ürünler, prova ve teslim" },
      { label: "İş listesi", href: "/isler", logistics: true, desc: "Tüm işler; duruma, hekime ve tarihe göre ara" },
      { label: "Prova / teslim listesi", href: "/isler/prova", logistics: true, desc: "Bugün ve önümüzdeki günlerde çıkacak prova ve teslimler" },
      { label: "Hekim / hastane kaydı", href: "/isler/hekimler", logistics: true, desc: "Hekim ve klinik kartları, yeni hekim ekleme, özel fiyatlar" },
      { label: "Protez / ürün ve fiyatlar", href: "/isler/urunler", logistics: true, desc: "Ürün listesi, TL / € fiyatlar, fiyat listesinden aktarma" },
      { label: "Laboratuvar listeleri", href: "/isler/ayarlar", logistics: true, desc: "Teslim şekilleri, prova türleri, banka bilgileri" },
    ],
  },
  {
    group: "Lojistik", slug: "lojistik",
    items: [
      { label: "Kargo, gümrük, kurye", href: "/kargo", logistics: true, desc: "Gelen ve giden paketler, DHL / UPS / gümrük takibi" },
      { label: "Paket okut", href: "/kargo/okut", logistics: true, desc: "Telefon kamerasıyla barkod okutup teslim al" },
      { label: "Kurye rotası", href: "/kargo/kurye", logistics: true, desc: "Kuryenin bugünkü alım ve teslimleri" },
    ],
  },
  {
    group: "Demirbaş ve zimmet", slug: "demirbas",
    items: [{ label: "Zimmet / demirbaş", href: "/zimmet", roles: HRM }],
  },
  {
    group: "İSG ve yasal uyum", slug: "isg-uyum",
    items: [
      { label: "İş güvenliği", href: "/isg", roles: MANAGERS },
      { label: "Sağlık", href: "/saglik", roles: ["owner", "hr", "safety"] },
      { label: "İş Kanunu uyumu", href: "/is-hukuku", roles: ["owner", "accountant", "hr"] },
      { label: "KVKK", href: "/kvkk", roles: ["owner", "hr"] },
      { label: "Mevzuat", href: "/mevzuat", roles: ["owner", "accountant", "hr"] },
    ],
  },
  { group: "Raporlar", slug: "raporlar", items: [{ label: "Raporlar", href: "/raporlar", roles: MANAGERS }, { label: "Excel'den aktar", href: "/ice-aktar", roles: PAY }] },
  { group: "Web sitesi", slug: "web-sitesi", items: [{ label: "Site yönetimi (mbdentaire.com)", href: "/site-gecis", site: true, raw: true }] },
  { group: "Sistem", slug: "sistem", items: [{ label: "Kiosk ekranı", href: "/kiosk", roles: ["owner", "hr", "branch_manager"] }, { label: "Yönetim ve yetkiler", href: "/yonetim", roles: ["owner", "hr"] }] },
];

const ALL_HREFS = () => NAV.flatMap((g) => g.items.map((i) => i.href));
/** Yol için en uygun (en uzun eşleşen) menü bağlantısı */
export function activeHref(path: string): string | null {
  let best: string | null = null;
  for (const h of ALL_HREFS()) {
    const hit = h === "/" ? path === "/" : path === h || path.startsWith(`${h}/`);
    if (hit && (!best || h.length > best.length)) best = h;
  }
  return best;
}

/** Kullanıcının yetkili olduğu modüller: rol + web sitesi erişimi */
export function visibleNav(role: string, siteAccess = false, logistics = false) {
  return NAV.map((g) => ({ ...g, items: g.items.filter((i) => (i.site ? siteAccess : i.logistics ? logistics : !i.roles || i.roles.includes(role))) })).filter((g) => g.items.length);
}


/** Modül ana sayfasında ek olarak gösterilecek ilgili modüllerin bağlantıları */
export const RELATED: Record<string, string[]> = {
  laboratuvar: ["cari", "lojistik"],
  cari: ["laboratuvar"],
  lojistik: ["laboratuvar"],
  "insan-kaynaklari": ["puantaj-izin"],
  "muhasebe-bordro": ["cari"],
};
