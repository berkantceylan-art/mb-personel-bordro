/** Site yönetim paneli menüsü: modül grupları (ikon adı = slug) */
export type AdminItem = { href: string; label: string; desc?: string };
export type AdminGroup = { slug: string; title: string; short: string; items: AdminItem[] };

export const ADMIN_NAV: AdminGroup[] = [
  {
    slug: "genel",
    title: "Genel",
    short: "Genel",
    items: [
      { href: "/admin", label: "Pano", desc: "Bugünün özeti: mesajlar, vakalar, bekleyen işler" },
      { href: "/admin/kontrol", label: "Site kontrol merkezi", desc: "Ziyaretçi, il / şehir, kaynak, giriş yapanlar, Google ve yapay zekâ görünürlüğü" },
      { href: "/admin/yapay-zeka", label: "Yapay zekâ görünürlüğü", desc: "ChatGPT, Perplexity, Gemini'de MB Dental geçiyor mu: aylık test" },
      { href: "/admin/istatistik", label: "Portal istatistikleri", desc: "Mesaj, canlı destek, portal hesap ve vaka sayıları" },
      { href: "/admin/canli-destek", label: "Canlı destek", desc: "Sitedeki ziyaretçilerle anlık yazışma" },
      { href: "/admin/gelen-kutusu", label: "Gelen kutusu", desc: "İletişim formu ve vaka talepleri" },
      { href: "/admin/adaylar", label: "Adaylar", desc: "Form, canlı destek, randevu ve portal kayıtları: takip, sorumlu, dönüşüm" },
    ],
  },
  {
    slug: "portal",
    title: "Hekim portalı",
    short: "Portal",
    items: [
      { href: "/admin/portal/vakalar", label: "Portal vakaları", desc: "Hekimlerin portaldan gönderdiği vakalar" },
      { href: "/admin/portal", label: "Portal hesapları", desc: "Hekim, klinik ve aracı kuruluş hesapları, onay bekleyenler" },
      { href: "/admin/fiyat-listesi", label: "Fiyat listesi", desc: "Portal fiyat listesi ve fiyat talepleri" },
    ],
  },
  {
    slug: "icerik",
    title: "Site içeriği",
    short: "İçerik",
    items: [
      { href: "/admin/slaytlar", label: "Slaytlar", desc: "Ana sayfa üst görselleri" },
      { href: "/admin/hikayeler", label: "Hikâyeler", desc: "Ana sayfadaki kısa hikâyeler" },
      { href: "/admin/duyurular", label: "Duyurular", desc: "Site ve portal duyuruları" },
      { href: "/admin/urunler", label: "Ürünler", desc: "Ürün sayfaları ve teslim süreleri" },
      { href: "/admin/vakalar", label: "Vaka galerisi", desc: "Önce / sonra vaka görselleri" },
      { href: "/admin/sayfalar", label: "Sayfalar", desc: "Hakkımızda, KVKK ve diğer sayfalar" },
      { href: "/admin/sss", label: "Sıkça sorulanlar", desc: "SSS soruları ve cevapları" },
      { href: "/admin/bolgeler", label: "Şehir ve ülke sayfaları", desc: "Bölge aramaları için hizmet sayfaları" },
      { href: "/admin/blog", label: "Blog", desc: "Blog yazıları, zamanlanmış yayın" },
      { href: "/admin/icerik-takvimi", label: "İçerik takvimi", desc: "Blog ve sosyal medya planı, yapay zekâ ile taslak" },
      { href: "/admin/seo", label: "SEO denetimi", desc: "Eksik başlık, açıklama, çeviri, görsel; 404 sayfalar" },
      { href: "/admin/ab-test", label: "A/B testi", desc: "Hangi metin daha çok tıklanıyor" },
      { href: "/admin/gorusler", label: "Hekim görüşleri", desc: "İzinli hekim görüşleri" },
      { href: "/admin/malzemeler", label: "Malzeme kütüphanesi", desc: "Zirkon, E.max, PMMA… teknik özellikler" },
      { href: "/admin/egitimler", label: "Eğitimler / webinar", desc: "Hekim eğitimleri ve kayıtlar" },
      { href: "/admin/belgeler", label: "Belgeler ve basın", desc: "Sertifikalar, üyelikler, ödüller, basında biz" },
    ],
  },
  {
    slug: "kurumsal",
    title: "Kurumsal",
    short: "Kurum",
    items: [
      { href: "/admin/departmanlar", label: "Departmanlar", desc: "Sitedeki departman tanıtımları" },
      { href: "/admin/ekip", label: "Çalışanlar", desc: "Ekibimiz sayfasında görünen kişiler" },
    ],
  },
  {
    slug: "sistem",
    title: "Sistem",
    short: "Sistem",
    items: [
      { href: "/admin/ayarlar", label: "Site ayarları", desc: "İletişim, çalışma saatleri, sosyal medya" },
      { href: "/admin/medya", label: "Medya kütüphanesi", desc: "Yüklenen görseller ve dosyalar" },
      { href: "/admin/guvenlik", label: "Hesap güvenliği (2FA)", desc: "İki adımlı doğrulama" },
      { href: "/admin/gecmis", label: "Değişiklik geçmişi", desc: "Kim neyi ne zaman değiştirdi" },
    ],
  },
];

export const ADMIN_HREFS = ADMIN_NAV.flatMap((g) => g.items.map((i) => i.href));

/** Yol için en uzun eşleşen menü bağlantısı */
export function adminActive(path: string): string | null {
  let best: string | null = null;
  for (const h of ADMIN_HREFS) {
    const hit = h === "/admin" ? path === "/admin" : path === h || path.startsWith(`${h}/`);
    if (hit && (!best || h.length > best.length)) best = h;
  }
  return best;
}
