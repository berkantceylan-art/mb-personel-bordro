/** site: yalnız web sitesi yönetim yetkisi olana; raw: Next bağlantısı değil, düz adres (sunucu yönlendirmesi) */
export type Item = { label: string; href: string; desc?: string; roles?: string[]; site?: boolean; logistics?: boolean; raw?: boolean; module?: string | string[]; level?: number };
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
      { label: "Gösterge Paneli", href: "/", module: ["hr", "attendance", "payroll", "safety", "lab", "finance", "sales", "purchases", "stock", "production", "assets", "expenses", "users"] },
      { label: "Patron ekranı", href: "/patron", roles: ["owner", "accountant"] },
      { label: "Müşteri ciroları", href: "/ciro", module: "revenue", desc: "Hekim, klinik, aracı kurum: günlük, aylık ya da iki tarih arası ciro, değişim, tahsilat" },
      { label: "Bildirimler", href: "/bildirimler" },
      { label: "Duyurular", href: "/duyurular" },
      { label: "Mesajlar", href: "/mesajlar" },
      { label: "WhatsApp İK", href: "/ik-whatsapp", module: "hr", desc: "Personelin şirket WhatsApp mesajları; yanıt WhatsApp'tan gider, görev kapanır" },
      { label: "Posta", href: "/posta", desc: "Gmail / Google Workspace hesaplarınız; e-postayı siparişe, CRM'e, hatırlatmaya aktarın" },
      { label: "Talepler", href: "/talepler", module: ["hr", "attendance", "payroll"], roles: [...new Set([...PAY, ...HR])] },
      { label: "İsteklerim", href: "/istekler", desc: "Demirbaş ve dış sipariş (kartuş, temizlik, kırtasiye) iste, teslimde imzala" },
      { label: "Arıza / servis", href: "/servis", desc: "Bozulan masa, fiş, cihaz bildir; tamir, dış servis, periyodik bakım, ücret onayı ve ödeme" },
      { label: "Teknik servis", href: "/teknik-servis", desc: "Teknik servis ekranı: atanan işler, tüm demirbaşlar, bakım takvimi" },
      { label: "Kameralar", href: "/kameralar", desc: "Yetkili olduğunuz kameraların canlı görüntüsü" },
      { label: "Ziyaretçilerim", href: "/ziyaretci", desc: "Misafirini önceden kaydet, QR davetiye, geldiğinde bildirim" },
      { label: "Güvenlik paneli", href: "/guvenlik", desc: "Ziyaretçi giriş-çıkış, kart, içeridekiler" },
      { label: "Onaylar", href: "/onaylar", desc: "Onay akışında sizi bekleyen masraf ve satın alma talepleri" },
      { label: "Asistan", href: "/asistan", desc: "Doğal dille soru: İK, iş durumu, cari, nakit, stok, kalite" },
    ],
  },
  {
    group: "Benim sayfam", slug: "benim",
    items: [
      { label: "Benim sayfam", href: "/benim", roles: ["employee"] },
      { label: "Avans iste", href: "/benim/avans", roles: ["employee"] },
      { label: "Masraf beyanı", href: "/benim/masraf", desc: "Fiş fotoğrafı ile masraf bildir" },
      { label: "Görevlerim", href: "/benim/gorevler", desc: "Yöneticinin size atadığı işler" },
      { label: "İzin", href: "/benim/izin", roles: ["employee"] },
      { label: "Bordrolarım", href: "/benim/bordro", roles: ["employee"] },
      { label: "Hesap hareketlerim", href: "/benim/hareketler", roles: ["employee"] },
      { label: "Puantajım", href: "/benim/puantaj", roles: ["employee"] },
      { label: "Takvimim", href: "/benim/takvim", roles: ["employee"] },
      { label: "Özlük bilgilerim", href: "/benim/ozluk", roles: ["employee"] },
      { label: "Belgelerim", href: "/benim/belgeler", roles: ["employee"] },
      { label: "Malzeme isteklerim", href: "/benim/malzeme", desc: "Depodan malzeme iste, teslimde imzala" }, { label: "Zimmetim", href: "/benim/zimmet", roles: ["employee"] },
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
      { label: "İK özeti", href: "/ik-ozet", module: "hr", roles: MANAGERS, desc: "Personel sayısı, maaş yükü, ödemeler, İSG uyarıları, bölümler" },
      { label: "Personel", href: "/personel", module: "hr", roles: MANAGERS },
      { label: "Özlük dijitalleştirme", href: "/ozluk-sihirbazi", module: "hr", roles: ["owner", "accountant", "hr"], desc: "Kâğıt özlük klasörlerini kamera / tarayıcıyla aktar: kimlik, işe giriş, evraklar, eski bordrolar, izinler" },
      { label: "İşe alım ve ilanlar", href: "/ise-alim", module: "hr", roles: HRM },
      { label: "Uyum süreci", href: "/uyum", module: "hr", roles: HRM },
      { label: "Performans", href: "/performans", module: "hr", roles: HRM },
      { label: "Yetkinlik ve hedefler", href: "/yetkinlik", module: "hr", roles: HRM },
      { label: "Organizasyon", href: "/organizasyon", module: "hr", roles: MANAGERS },
    ],
  },
  {
    group: "Puantaj ve izin", slug: "puantaj-izin",
    items: [
      { label: "Puantaj", href: "/puantaj", module: "attendance", roles: MANAGERS },
      { label: "Vardiyalar", href: "/vardiyalar", module: "attendance", roles: MANAGERS },
      { label: "Yıllık izin", href: "/yillik-izin", module: "attendance", roles: HRM },
      { label: "İzin kayıtları", href: "/izin", module: "attendance", roles: MANAGERS },
      { label: "Fazla mesai", href: "/fazla-mesai", module: "attendance", roles: MANAGERS },
      { label: "Mesai yemeği", href: "/yemek", module: "attendance", roles: HRM },
    ],
  },
  {
    group: "Genel muhasebe", slug: "genel-muhasebe",
    items: [
      { label: "Genel muhasebe", href: "/muhasebe", module: "ledger", desc: "ERP kayıtlarının otomatik muhasebe fişleri, ayarlar, kurulum" },
      { label: "Muhasebe fişleri", href: "/muhasebe/fisler", module: "ledger", desc: "Mahsup, tahsil, tediye; eşleştirme bekleyenler; elle fiş" },
      { label: "Hesap planı", href: "/muhasebe/hesap-plani", module: "ledger", desc: "Tek Düzen Hesap Planı, alt hesaplar, Excel'den aktarma" },
      { label: "Eşleştirme", href: "/muhasebe/eslestirme", module: "ledger", level: 3, desc: "Kasa, banka, kart, cari, kategori → hesap kodu" },
      { label: "Mizan", href: "/muhasebe/mizan", module: "ledger", desc: "Dönem mizanı, seviye, grup toplamları, Excel" },
      { label: "Muavin / kebir", href: "/muhasebe/kebir", module: "ledger", desc: "Hesap ekstresi, devir ve yürüyen bakiye" },
      { label: "Yevmiye defteri", href: "/muhasebe/yevmiye", module: "ledger", desc: "Madde madde, tarih sırasıyla; numaralandırma" },
      { label: "Bilanço", href: "/muhasebe/bilanco", module: "ledger", desc: "Aktif / pasif, Tek Düzen biçimi" },
      { label: "Gelir tablosu", href: "/muhasebe/gelir-tablosu", module: "ledger", desc: "Brüt satışlardan dönem net kârına" },
      { label: "Beyanname hazırlık", href: "/muhasebe/beyanname", module: "ledger", desc: "KDV1, KDV2, muhtasar ve prim hizmet, damga vergisi, KDV iadesi" },
      { label: "Dönem sonu işlemleri", href: "/muhasebe/donem-sonu", module: "ledger", desc: "Amortisman, dönemsellik, faiz tahakkuku, yansıtma, yeniden değerleme, 131 / 331" },
      { label: "Geçici ve kurumlar vergisi", href: "/muhasebe/vergi", module: "ledger", desc: "Dönem kârı, KKEG, ihracat indirimi, asgari kurumlar vergisi, 193 / 370 fişleri" },
      { label: "Mevzuat ve gelişmeler", href: "/mevzuat", module: "ledger", desc: "Muhasebe, vergi, SGK ve iş hukuku gelişmeleri; okundu / yapıldı takibi, bildirim" },
      { label: "Vergi takvimi", href: "/muhasebe/vergi-takvimi", module: "ledger", desc: "Beyanname son günleri ve durumları (hazırlandı, verildi, ödendi)" },
      { label: "Dönem işlemleri", href: "/muhasebe/donem", module: "ledger", desc: "Ay ay durum, kur değerleme, yıl sonu kapanış / açılış, dönem kilidi" },
      { label: "Aktarım", href: "/muhasebe/aktar", module: "ledger", desc: "Fişleri Luca / Zirve / Excel'e aktar" },
    ],
  },
  {
    group: "Muhasebe ve bordro", slug: "muhasebe-bordro",
    items: [
      { label: "Ay sonu", href: "/ay-sonu", module: "payroll", roles: PAY },
      { label: "Bordro", href: "/bordro", module: "payroll", roles: PAY },
      { label: "Bordro sihirbazı", href: "/bordro/sihirbaz", module: "payroll", roles: PAY, desc: "Personel personel: puantaj, rapor, fazla mesai, prim, BES, icra, avans, özet ve onay" },
      { label: "Maaş planı ve ödeme", href: "/maas-plani", module: "payroll", roles: PAY, desc: "Bu ay kime ne kadar resmi / elden, BES, icra; ödendi işaretle, kasa / bankadan düşsün" },
      { label: "Dönemler", href: "/donemler", module: "payroll", roles: PAY },
      { label: "Avans ve ödemeler", href: "/odemeler/yeni", module: "payroll", roles: PAY },
      { label: "Zamlar", href: "/zamlar", module: "payroll", roles: PAY },
      { label: "BES", href: "/bes", module: "payroll", roles: PAY },
      { label: "İcra ve nafaka", href: "/icra", module: "payroll", roles: PAY },
      { label: "SGK işlemleri", href: "/sgk", module: ["payroll", "hr"], roles: ["owner", "accountant", "hr"] },
    ],
  },
  {
    group: "Finans", slug: "finans",
    items: [
      { label: "Finans özeti", href: "/finans", module: "finance", desc: "Kasa, banka, alacak ve borçların anlık durumu" },
      { label: "Kasa", href: "/finans/kasa", module: "finance", desc: "Nakit kasalar ve hareketleri" },
      { label: "Banka", href: "/finans/banka", module: "finance", desc: "Banka hesapları (TL / döviz) ve hareketleri" },
      { label: "İşlem gir", href: "/finans/islem", module: "finance", level: 2, desc: "Tahsilat, ödeme, virman, gelir, masraf" },
      { label: "Banka ekstresi aktar", href: "/finans/banka-aktar", module: "finance", level: 2, desc: "Excel / CSV / CAMT / MT940 ekstre: otomatik eşleştirme, cari önerisi, tek tıkla işleme" },
      { label: "İşlem defteri", href: "/finans/islemler", module: "finance", desc: "Tüm finans kayıtları, iptal" },
      { label: "Çek ve senet", href: "/finans/cek-senet", module: "finance", desc: "Portföy, tahsil, ciro, karşılıksız, vade takvimi" },
      { label: "Kredi kartları", href: "/finans/kredi-karti", module: "finance", desc: "Limit, taksitli harcama, ekstre tahmini, borç ödeme" },
      { label: "Krediler", href: "/finans/krediler", module: "finance", desc: "Ödeme planı, taksit ödemesi (anapara / faiz / BSMV)" },
      { label: "Avans hesapları", href: "/finans/avans", module: "finance", desc: "Personel iş avansı: ver, masrafla kapat, iade" },
      { label: "Ortak hesapları", href: "/finans/ortaklar", module: "finance", desc: "Ortaktan giriş, ortağa çıkış, ortağın ödediği masraflar" },
      { label: "Veresiye ve alacaklar", href: "/finans/veresiye", module: ["finance", "sales"], desc: "Açık hesap, yaşlandırma, limit, WhatsApp hatırlatma" },
      { label: "Nakit akışı tahmini", href: "/finans/nakit-akisi", module: "finance", desc: "13 hafta: alacak, çek, borç, kredi, masraf, sipariş ve maaşla beklenen bakiye" },
      { label: "Grup konsolidasyonu", href: "/finans/konsolidasyon", module: "finance", level: 2, desc: "Grup şirketleri tek para biriminde, grup içi işlemler elenmiş aylık özet" },
      { label: "Döviz kurları", href: "/finans/kurlar", module: "finance", desc: "TCMB kurları, elle kur girişi" },
      { label: "Gelir / gider hesapları", href: "/finans/kategoriler", module: "finance", desc: "Kategoriler ve dönem özeti" },
    ],
  },
  {
    group: "Cari", slug: "cari",
    items: [
      { label: "Müşteri takibi (CRM)", href: "/crm", module: ["sales", "lab"], desc: "Potansiyel klinikler, görüşme / numune / teklif, bugünün adımları, geri kazanma" },
      { label: "Cari mutabakat", href: "/finans/mutabakat", module: ["finance", "sales"], desc: "Tarih itibarıyla bakiye mektubu; cari bağlantıdan ya da portaldan onaylar / itiraz eder" },
      { label: "Fişli / faturalı cariler", href: "/finans/fis-cari", module: ["finance", "purchases"], desc: "Aynı firmanın iki carisi: faturalı ve fişli (faturasız) alımlar; ödeme / çek iki cariye de düşer" },
      { label: "Cari kartlar (tedarikçi / müşteri)", href: "/finans/cariler", module: ["finance", "sales", "purchases"], desc: "Tüm cariler, para birimi, açılış bakiyesi, ekstre" },
      { label: "Hekim cari hesapları", href: "/isler/cari", module: "lab", desc: "Hekim bakiyeleri, tahsilat ve ekstre" },
      { label: "Hekim / hastane kartları", href: "/isler/hekimler", module: "lab" },
    ],
  },
  {
    group: "Alış ve satış", slug: "alis-satis",
    items: [
      { label: "Satış özeti", href: "/satis", module: "sales", desc: "Aylık satış, en çok çalışılan hekimler, vadesi geçenler" },
      { label: "Satış faturası kes", href: "/satis/yeni", module: "sales", level: 2, desc: "Protez, malzeme, hizmet; e-Fatura / e-Arşiv, döviz, iskonto, tevkifat" },
      { label: "Satış faturaları", href: "/satis/faturalar", module: "sales", desc: "Kesilen faturalar, e-fatura durumu, toplu XML indirme" },
      { label: "Faturalanmamış işler", href: "/satis/isler", module: "sales", desc: "Teslim edilen laboratuvar işlerini hekim bazında faturala" },
      { label: "Müşteri kârlılığı", href: "/satis/karlilik", module: ["sales", "finance"], desc: "Ciro, malzeme, işçilik, genel gider ve kâr; yeniden yapımlar" },
      { label: "Alış özeti", href: "/alis", module: "purchases", desc: "Aylık alış, tedarikçiler, vadesi geçen borçlar" },
      { label: "Verilen siparişler (tedarikçi)", href: "/alis/siparisler", module: ["purchases", "stock"], desc: "Depo hazırlar, satın alma onaylar, tedarikçiye e-posta + WhatsApp ile gider; tedarikçi onayı, termin, sevk" }, { label: "Tedarikçi kullanıcıları", href: "/alis/tedarikci-kullanicilari", module: "purchases", desc: "Tedarikçiye hesap tanımlayın; siparişleri kendi ekranından görsün" },
      { label: "Alış faturası gir", href: "/alis/yeni", module: "purchases", level: 2, desc: "Malzeme, hammadde, sarf, hizmet alışı; stoğa giriş" },
      { label: "e-Fatura içe aktar", href: "/alis/ice-aktar", module: ["purchases", "sales"], level: 2, desc: "UBL XML / ZIP: cari yoksa açılır, kalemler stokla eşleşir" },
      { label: "Alış faturaları", href: "/alis/faturalar", module: "purchases", desc: "Gelen faturalar, iade, iptal" },
      { label: "Fatura ayarları", href: "/satis/ayarlar", module: "sales", desc: "Şirket VKN / adres, seri önekleri, KDV, entegratör" },
    ],
  },
  {
    group: "Stok ve depo", slug: "stok",
    items: [
      { label: "Stok özeti", href: "/stok", module: "stock", desc: "Stok değeri, kritik seviye, son kullanma yaklaşanlar" },
      { label: "Ürün / malzeme kartları", href: "/stok/urunler", module: "stock", desc: "Hammadde, sarf, mamul, hizmet; barkod, lot, SKT, min-max" },
      { label: "Depolar", href: "/stok/depolar", module: "stock", desc: "Ana depo, üretim, karantina; depo bazında stok" },
      { label: "Depo transferi", href: "/stok/transfer", module: "stock", desc: "İki aşamalı transfer: gönder, yolda, teslim al" },
      { label: "Stok sayımı", href: "/stok/sayim", module: "stock", desc: "Telefonla barkod okutarak sayım, kör sayım, fark işleme" },
      { label: "İstekler (malzeme / demirbaş / sipariş)", href: "/stok/talepler", module: ["stock", "purchases"], desc: "Malzeme, demirbaş ve dış sipariş istekleri: depodan teslim, satın almaya gönder, çift imzalı teslim tutanağı" }, { label: "Mal kabul (okut)", href: "/stok/mal-kabul", module: ["stock", "purchases"], desc: "Gelen malı barkodla teyit et; faturalı / faturasız, e-faturayla eşleştir" }, { label: "Personele teslim (okut)", href: "/stok/teslim", module: "stock", level: 2, desc: "Ürünleri okut, iki imzalı teslim tutanağı" }, { label: "Alım listeleri", href: "/stok/talepler/alim", module: ["purchases", "stock"], desc: "Onaylı satın almalardan tedarikçiye göre liste, kuryeye ata" }, { label: "Stok hareketleri", href: "/stok/hareketler", module: "stock", desc: "Tüm giriş-çıkışlar, maliyet ve belge bağlantısı" },
      { label: "Lot izlenebilirliği", href: "/stok/lotlar", module: ["stock", "production"], desc: "SKT radarı, karantina, geri çağırma; lot hangi işe, hangi hekime gitti" },
      { label: "ÜTS bildirimleri", href: "/stok/uts", module: ["stock", "production"], desc: "Ürün Takip Sistemi: alma, kullanım, verme, ısmarlama; karekodla mal kabul" },
      { label: "Ürün reçeteleri", href: "/stok/receteler", module: ["stock", "production"], desc: "Protez başına malzeme ihtiyacı ve malzeme maliyeti" },
    ],
  },
  {
    group: "Laboratuvar / üretim", slug: "laboratuvar",
    items: [
      { label: "Siparişler", href: "/isler/siparisler", module: "lab", desc: "Telefon, WhatsApp, e-posta, tarayıcı ve portal siparişleri; tek tuşla iş kaydı" },
      { label: "İş kayıt", href: "/isler/yeni", module: "lab", desc: "Yeni iş: hekim, hasta, diş şeması, ürünler, prova ve teslim" },
      { label: "İş listesi", href: "/isler", module: "lab", desc: "Tüm işler; duruma, hekime ve tarihe göre ara" },
      { label: "Günlük irsaliyeler", href: "/isler/irsaliye", module: ["lab", "sales"], desc: "Her gün müşteriye giden işlerin irsaliyesi; yazdır, kesildi" },
      { label: "Aylık faturalama", href: "/isler/aylik-fatura", module: ["lab", "sales"], desc: "Ay sonunda irsaliyeleri müşteri başına tek faturada topla (TR / EN / FR)" },
      { label: "Prova / teslim listesi", href: "/isler/prova", module: "lab", desc: "Bugün ve önümüzdeki günlerde çıkacak prova ve teslimler" },
      { label: "Atölye ekranı (TV)", href: "/atolye", module: ["production", "lab"], desc: "Şirketteki bilgisayar için tam ekran canlı pano: giren, çıkan, kalan, aşama, ekip, klinik" },
      { label: "Kontrol hattı", href: "/kalite-hatti", module: "production", desc: "Birinci kontrol → son kontrol → paketleme / çıkış: canlı pano" },
      { label: "Birinci kontrol", href: "/kalite-hatti/birinci", module: "production", desc: "İşi okut, kontrol listesi, onayla / geri gönder" },
      { label: "Son kontrol", href: "/kalite-hatti/son", module: "production", desc: "Son kontrol ve paketlemeye teslim" },
      { label: "Paketleme / çıkış", href: "/kalite-hatti/paket", module: "production", desc: "Okutarak paketle, paketleyen kayıtlı, etiket ve toplu çıkış" },
      { label: "Kutu okut", href: "/uretim/okut", module: "production", desc: "Kutuyu okut: aldım / bitirdim, şef ve kalite onayı, çıkış" },
      { label: "İş nerede?", href: "/uretim/nerede", module: "production", desc: "Her iş hangi aşamada, kimin elinde, ne zamandır" },
      { label: "Personel performansı", href: "/uretim/performans", module: "production", desc: "Kim kaç birim yaptı, birim başı süre, geri dönüş oranı" },
      { label: "Teknisyen primi", href: "/uretim/prim", module: ["production", "payroll"], level: 2, desc: "Birim, geri dönüş ve zamanında teslime göre aylık prim; bordroya aktarım" },
      { label: "Akış ekibi", href: "/uretim/ekip", module: "production", desc: "Teknisyen, şef, kontrol sorumlusu ve pazarlama rolleri" },
      { label: "Üretim panosu", href: "/uretim", module: "production", desc: "İstasyon istasyon işler, okutarak başla / bitir, gecikenler" },
      { label: "Kalite yönetimi", href: "/kalite", module: ["lab", "production", "sales"], desc: "Hekim şikâyetleri, uygunsuzluk ve DÖF, iç denetim, memnuniyet anketi" },
      { label: "Makineler ve kapasite", href: "/uretim/makineler", module: ["production", "lab"], desc: "Frez, yazıcı, fırın kuyruğu; takım ömrü, bakım, arıza; günlük kapasite planı" },
      { label: "Talep tahmini", href: "/uretim/talep-tahmini", module: ["production", "stock", "purchases"], desc: "Gelecek ayın hacmi ve malzeme ihtiyacı, kaç gün yeter, tek tıkla satın alma siparişi" },
      { label: "Üretim raporu", href: "/uretim/rapor", module: "production", desc: "Teknisyen verimi, yeniden yapım analizi, lot geri izleme" },
      { label: "İstasyon ve rotalar", href: "/uretim/ayarlar", module: "production", desc: "Ürün başına istasyon sırası, süre, malzeme düşüm adımı" },
      { label: "Hekim / hastane kaydı", href: "/isler/hekimler", module: "lab", desc: "Hekim ve klinik kartları, yeni hekim ekleme, özel fiyatlar" },
      { label: "Protez / ürün ve fiyatlar", href: "/isler/urunler", module: "lab", desc: "Ürün listesi, TL / € fiyatlar, fiyat listesinden aktarma" },
      { label: "Laboratuvar listeleri", href: "/isler/ayarlar", module: "lab", desc: "Teslim şekilleri, prova türleri, banka bilgileri" },
    ],
  },
  {
    group: "Lojistik", slug: "lojistik",
    items: [
      { label: "Kurye ekranı", href: "/kurye", module: "lab", desc: "Bugünün teslimatları ve ölçü almaları: harita, arama, WhatsApp, imzayla teslim" },
      { label: "Kargo, gümrük, kurye", href: "/kargo", module: "lab", desc: "Gelen ve giden paketler, DHL / UPS / gümrük takibi" },
      { label: "Paket okut", href: "/kargo/okut", module: "lab", desc: "Telefon kamerasıyla barkod okutup teslim al" },
      { label: "Kurye rotası", href: "/kargo/kurye", module: "lab", desc: "Kuryenin bugünkü alım ve teslimleri" },
    ],
  },
  {
    group: "Demirbaş ve zimmet", slug: "demirbas",
    items: [
      { label: "Demirbaş listesi", href: "/demirbas", module: "assets", desc: "Değer, amortisman, net defter değeri, bakım ve garanti" },
      { label: "Zimmet", href: "/zimmet", module: ["hr", "assets"], roles: HRM, desc: "Demirbaş ekle, personele zimmetle, iade al" },
      { label: "Demirbaş sayımı", href: "/demirbas/sayim", module: "assets", desc: "QR / barkod okutarak sayım: eksik, fazla, yer değişen, arızalı" },
      { label: "QR etiket bas", href: "/demirbas/etiket", module: "assets", desc: "Demirbaşlar için A4 QR etiket" },
      { label: "Amortisman", href: "/demirbas/amortisman", module: "assets", desc: "Aylık amortismanı tek tuşla işle" },
    ],
  },
  {
    group: "Masraflar", slug: "masraf",
    items: [
      { label: "Masraflar ve onay", href: "/masraf", module: "expenses", desc: "Fişli masraf beyanı, yapay zekâ ile okuma, onay ve finansa işleme" },
      { label: "Tekrarlayan masraflar", href: "/masraf/tekrarlayan", module: "expenses", desc: "Kira, aidat, abonelik: her ay otomatik kuyruğa" },
    ],
  },
  {
    group: "İSG ve yasal uyum", slug: "isg-uyum",
    items: [
      { label: "İş güvenliği", href: "/isg", module: "safety", roles: MANAGERS },
      { label: "Sağlık", href: "/saglik", module: "safety", roles: ["owner", "hr", "safety"] },
      { label: "İş Kanunu uyumu", href: "/is-hukuku", module: "safety", roles: ["owner", "accountant", "hr"] },
      { label: "KVKK", href: "/kvkk", module: "safety", roles: ["owner", "hr"] },
      { label: "Mevzuat ve gelişmeler", href: "/mevzuat", module: "safety", roles: ["owner", "accountant", "hr"] },
    ],
  },
  { group: "Raporlar", slug: "raporlar", items: [{ label: "Yönetim KPI", href: "/kpi", module: ["sales", "finance", "production"], desc: "Ciro, birim, zamanında teslim, yeniden yapım, üretim süresi, tahsilat süresi" }, { label: "Raporlar", href: "/raporlar", module: ["hr", "attendance", "payroll", "safety"], roles: MANAGERS }, { label: "Rapor tasarlayıcı", href: "/rapor-tasarla", module: ["lab", "sales", "production", "finance", "purchases", "stock", "expenses"], desc: "Kendi tablo ve grafiğinizi kurun: işler, ürünler, tahsilat, masraf, fatura, şikâyet, stok" }, { label: "Excel'den aktar", href: "/ice-aktar", module: "payroll", roles: PAY }] },
  { group: "Web sitesi", slug: "web-sitesi", items: [{ label: "Reklam, hekim duyurusu, yardım videosu", href: "/site-icerik", site: true, desc: "Ana sayfada dönen reklamlar (tarih aralıklı), portal duyuruları, güncelleme duyuruları, Yardım videoları" }, { label: "Site yönetimi (mbdentaire.com)", href: "/site-gecis", site: true, raw: true }] },
  { group: "Sistem", slug: "sistem", items: [{ label: "Kiosk ekranı", href: "/kiosk", module: "attendance", roles: ["owner", "hr", "branch_manager"] }, { label: "Kontrol Merkezi", href: "/yonetim/kontrol", module: "users", level: 3, desc: "Sistem sağlık skoru: eksik, hatalı, yapılması gereken her şey; eksik SQL güncellemeleri" }, { label: "Sistem nabzı", href: "/yonetim/nabiz", module: "users", level: 3, desc: "Canlı işlem akışı, anomali uyarıları, kullanım ısı haritası, kullanıcı 360°" }, { label: "İş akışı denetimi", href: "/yonetim/is-akisi", module: "production", level: 3, desc: "İş kaydından teslime: takılan, geciken, sahipsiz işler; yönetici her aşamayı çözer" }, { label: "Kullanıcılar ve hesaplar", href: "/yonetim", module: "users", desc: "Kullanıcılar, personele hesap açma, kullanıcı türleri" }, { label: "Yetki haritası", href: "/yonetim/yetkiler", module: "users", desc: "Kim hangi modülde ne yapabilir: tek bakışta" }, { label: "Onay akışları", href: "/yonetim/onay-akislari", module: "users", level: 3, desc: "Masraf ve satın alma için tutara göre sıralı onay adımları" }, { label: "Şirket ayarları", href: "/yonetim/sirket", module: "users", level: 2, desc: "Şirket bilgileri, şubeler, bölümler, PDKS cihazları" }, { label: "İşlem geçmişi", href: "/yonetim/hareketler", module: "users", level: 2, desc: "Kim, ne zaman, neyi değiştirdi (denetim kaydı)" }, { label: "Kullanıcı olarak görüntüle", href: "/yonetim/goruntule", roles: ["owner"], desc: "Personel, klinik ve hekim ekranlarını şifresiz, yalnız görüntüleme modunda açın" }, { label: "Sistemi temizle", href: "/yonetim/temizle", roles: ["owner"], desc: "Deneme kayıtlarını modül modül silip canlı kullanıma temiz başlayın (yedekli, onaylı)" }] },
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

/** Menü öğesi bu kullanıcıya açık mı: modül seviyesi VE (varsa) rol — rol, verinin korunduğu temel erişimdir */
export function itemAllowed(role: string, siteAccess = false, logistics = false, modules: Record<string, number> = {}) {
  return (i: Item) => {
    if (role !== "owner" && i.module && !(Array.isArray(i.module) ? i.module : [i.module]).some((m) => (modules[m] ?? 0) >= (i.level ?? 1))) return false;
    if (i.site) return siteAccess;
    if (i.logistics) return logistics;
    return !i.roles || i.roles.includes(role);
  };
}

/** Sayfa koruması: yol bir menü öğesine düşüyorsa ve öğe kapalıysa false */
export function pathAllowed(path: string, role: string, siteAccess: boolean, logistics: boolean, modules: Record<string, number>): boolean {
  const href = activeHref(path);
  if (!href) return true;
  const items = NAV.flatMap((g) => g.items).filter((i) => i.href === href);
  // Yalnız modüle bağlı sayfalar korunur; diğerleri kendi sayfa kontrolünü yapar
  if (!items.some((i) => i.module)) return true;
  const ok = itemAllowed(role, siteAccess, logistics, modules);
  return items.some(ok);
}

/** Kullanıcının yetkili olduğu modüller: rol + web sitesi erişimi */
export function visibleNav(role: string, siteAccess = false, logistics = false, modules: Record<string, number> = {}) {
  const ok = itemAllowed(role, siteAccess, logistics, modules);
  return NAV.map((g) => ({ ...g, items: g.items.filter(ok) })).filter((g) => g.items.length);
}


/** Modül ana sayfasında ek olarak gösterilecek ilgili modüllerin bağlantıları */
export const RELATED: Record<string, string[]> = {
  finans: ["cari"],
  laboratuvar: ["cari", "stok", "lojistik"],
  stok: ["laboratuvar", "alis-satis", "cari"],
  "alis-satis": ["cari", "stok", "finans"],
  cari: ["laboratuvar"],
  lojistik: ["laboratuvar"],
  "insan-kaynaklari": ["puantaj-izin"],
  "muhasebe-bordro": ["cari"],
};
