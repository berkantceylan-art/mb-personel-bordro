// Yardım merkezi metinleri (TR/EN/FR): hesap türüne göre kayıt adımları, panel özellikleri, SSS ve animasyonlu rehber adımları
import type { Locale } from "./i18n";

export type HelpAudience = "doctor_tr" | "doctor_foreign" | "clinic" | "agency";
export const HELP_AUDIENCES: HelpAudience[] = ["doctor_tr", "doctor_foreign", "clinic", "agency"];

/** Animasyonlu rehberdeki ekran çizimleri */
export type GuideScreen = "signup" | "verify" | "pending" | "profile" | "newcase" | "upload" | "track" | "chat" | "ship" | "account" | "team" | "clients" | "declaration";
export type GuideStep = { screen: GuideScreen; title: string; caption: string };
type Feature = { icon: string; t: string; d: string };
type Faq = { q: string; a: string };
type AudienceHelp = { label: string; short: string; who: string; steps: string[]; features: Feature[]; faq: Faq[]; guide: GuideStep[] };

export type HelpUI = {
  meta: { title: string; description: string };
  kicker: string;
  title: string;
  lead: string;
  choose: string;
  openAccount: string;
  signIn: string;
  stepsTitle: string;
  featuresTitle: string;
  guideTitle: string;
  guideLead: string;
  play: string;
  pause: string;
  prev: string;
  next: string;
  faqTitle: string;
  videosTitle: string;
  videosLead: string;
  updatesTitle: string;
  updatesLead: string;
  updatesEmpty: string;
  whyTitle: string;
  why: Feature[];
  helpTitle: string;
  helpText: string;
  contact: string;
  nav: string;
  types: Record<HelpAudience, AudienceHelp>;
  mock: Record<string, string>;
};

const COMMON_GUIDE_TR = (type: string): GuideStep[] => [
  { screen: "signup", title: "Hesap açın", caption: `“Hesap aç” formunda hesap türü olarak “${type}” seçin, bilgilerinizi ve şifrenizi yazın.` },
  { screen: "verify", title: "E-postanızı doğrulayın", caption: "Gelen kutunuzdaki bağlantıya tıklayın; spam klasörünü de kontrol edin." },
  { screen: "pending", title: "Onayı bekleyin", caption: "Laboratuvarımız hesabınızı genellikle aynı iş günü onaylar; onaylanınca e-posta gelir." },
  { screen: "profile", title: "Profilinizi tamamlayın", caption: "Teslimat ve fatura adresinizi, tercih ettiğiniz renk sistemini ve kargo firmasını girin." },
  { screen: "newcase", title: "Yeni vaka açın", caption: "Hasta kodu, ürün, dişler, renk ve istediğiniz teslim tarihini seçin." },
  { screen: "upload", title: "Dosyaları yükleyin", caption: "Ağız içi tarama (STL/PLY/OBJ), fotoğraf ve reçeteyi sürükleyip bırakın." },
  { screen: "track", title: "Vakayı canlı izleyin", caption: "Alındı, tasarım, üretim, kalite kontrol, kargo, teslim: her aşama anında görünür." },
  { screen: "chat", title: "Teknisyenle yazışın", caption: "Soruları vakanın içinden sorun; cevap ve dosyalar aynı yerde kalır." },
  { screen: "ship", title: "Kargo ve kurye", caption: "Ölçü gönderecekseniz kurye isteyin ya da kargo bilgisini girin; paketinizi takip edin." },
  { screen: "account", title: "Cari hesap ve faturalar", caption: "Yapılan işler, ekstre, faturalar ve proforma her zaman elinizin altında." },
];
const COMMON_GUIDE_EN = (type: string): GuideStep[] => [
  { screen: "signup", title: "Create your account", caption: `In the sign-up form choose “${type}” as the account type, then enter your details and a password.` },
  { screen: "verify", title: "Confirm your e-mail", caption: "Click the link in your inbox (check the spam folder too)." },
  { screen: "pending", title: "Wait for approval", caption: "Our lab usually approves accounts the same working day; you get an e-mail when it is done." },
  { screen: "profile", title: "Complete your profile", caption: "Add delivery and billing addresses, your shade system and preferred carrier." },
  { screen: "newcase", title: "Open a new case", caption: "Choose a patient code, product, teeth, shade and the delivery date you need." },
  { screen: "upload", title: "Upload your files", caption: "Drag and drop intraoral scans (STL/PLY/OBJ), photos and the prescription." },
  { screen: "track", title: "Track it live", caption: "Received, design, production, quality control, shipped, delivered: every stage shows up instantly." },
  { screen: "chat", title: "Message the technician", caption: "Ask questions inside the case; answers and files stay in one place." },
  { screen: "ship", title: "Shipping and courier", caption: "Sending a physical impression? Book a courier or enter your tracking number and follow the parcel." },
  { screen: "account", title: "Statement and invoices", caption: "Jobs, account statement, invoices and pro forma are always at hand." },
];
const COMMON_GUIDE_FR = (type: string): GuideStep[] => [
  { screen: "signup", title: "Créez votre compte", caption: `Dans le formulaire d’inscription, choisissez « ${type} » comme type de compte, puis saisissez vos informations et un mot de passe.` },
  { screen: "verify", title: "Confirmez votre e-mail", caption: "Cliquez sur le lien reçu (vérifiez aussi le dossier spam)." },
  { screen: "pending", title: "Attendez la validation", caption: "Notre laboratoire valide généralement les comptes le jour ouvré même ; vous recevez un e-mail." },
  { screen: "profile", title: "Complétez votre profil", caption: "Ajoutez vos adresses de livraison et de facturation, votre teintier et votre transporteur." },
  { screen: "newcase", title: "Ouvrez un nouveau cas", caption: "Choisissez un code patient, le produit, les dents, la teinte et la date de livraison souhaitée." },
  { screen: "upload", title: "Téléversez vos fichiers", caption: "Glissez-déposez vos scans intra-oraux (STL/PLY/OBJ), photos et prescription." },
  { screen: "track", title: "Suivez-le en direct", caption: "Reçu, conception, fabrication, contrôle qualité, expédié, livré : chaque étape s’affiche aussitôt." },
  { screen: "chat", title: "Échangez avec le technicien", caption: "Posez vos questions dans le cas ; réponses et fichiers restent au même endroit." },
  { screen: "ship", title: "Expédition et coursier", caption: "Une empreinte physique ? Demandez un coursier ou saisissez votre numéro de suivi." },
  { screen: "account", title: "Relevé et factures", caption: "Travaux, relevé de compte, factures et proforma toujours à portée de main." },
];

const insertAfter = (g: GuideStep[], after: GuideScreen, add: GuideStep[]) => {
  const i = g.findIndex((s) => s.screen === after);
  return [...g.slice(0, i + 1), ...add, ...g.slice(i + 1)];
};

const TR: HelpUI = {
  meta: { title: "Yardım merkezi: hesap açma ve portal kullanımı", description: "Hekim, yurtdışı hekim, klinik ve aracı kuruluşlar için MB Dental portalında hesap açma, vaka gönderme, takip, kargo ve fatura rehberi; videolar ve yenilikler." },
  kicker: "Yardım merkezi",
  title: "Portalı birkaç dakikada öğrenin",
  lead: "Hesap açmaktan ilk vakanızı göndermeye, takipten faturaya kadar her şey adım adım. Size uyan hesap türünü seçin.",
  choose: "Hesap türünüz",
  openAccount: "Ücretsiz hesap aç",
  signIn: "Giriş yap",
  stepsTitle: "Hesap nasıl açılır?",
  featuresTitle: "Panelinizde neler var?",
  guideTitle: "Adım adım anlatım",
  guideLead: "Portalın nasıl çalıştığını kısa bir canlandırmayla izleyin.",
  play: "Oynat",
  pause: "Duraklat",
  prev: "Önceki adım",
  next: "Sonraki adım",
  faqTitle: "Sık sorulanlar",
  videosTitle: "Kullanım videoları",
  videosLead: "Ekibimizin hazırladığı kısa videolar.",
  updatesTitle: "Yenilikler",
  updatesLead: "Portala eklenen yeni özellikler ve değişiklikler.",
  updatesEmpty: "Şimdilik yeni bir duyuru yok.",
  whyTitle: "Vakanızı neden portaldan göndermelisiniz?",
  why: [
    { icon: "⚡", t: "2 dakikada vaka", d: "Telefon, WhatsApp ve kâğıt reçete trafiği yok. Formu doldurun, dosyaları bırakın, gönderin." },
    { icon: "👁", t: "Her aşamayı canlı görün", d: "İşiniz tasarımda mı, üretimde mi, kargoda mı? Sormanıza gerek kalmadan ekranda." },
    { icon: "🎯", t: "Hata riski yok", d: "Diş, renk, ürün ve dosyalar tek kayıtta; bilgi kaybolmaz, yanlış anlaşılmaz." },
    { icon: "📦", t: "Kargo ve fatura tek yerde", d: "Kurye isteyin, paketi izleyin; ekstre ve faturalarınızı istediğiniz an indirin." },
  ],
  helpTitle: "Takıldığınız bir yer mi var?",
  helpText: "Ekibimiz hesap açarken ya da ilk vakanızda size yardımcı olur.",
  contact: "Bize ulaşın",
  nav: "Yardım",
  types: {
    doctor_tr: {
      label: "Hekim (Türkiye)", short: "Yerli hekim",
      who: "Türkiye'de muayenehanesi olan ya da bir klinikte çalışan diş hekimleri.",
      steps: [
        "Bu sayfadaki “Ücretsiz hesap aç” düğmesine ya da sitenin üstündeki “Giriş” › “Hesap aç” bağlantısına tıklayın.",
        "Hesap türü olarak “Hekim (Türkiye)” seçin; ad soyad, muayenehane adı, şehir, telefon, e-posta ve şifrenizi yazın.",
        "E-postanıza gelen bağlantıyla adresinizi doğrulayın.",
        "Laboratuvarımız hesabınızı onaylar (genellikle aynı iş günü). Onayla birlikte cari hesabınız otomatik açılır.",
        "Giriş yapıp “Profil”de teslimat ve fatura bilgilerinizi tamamlayın, ardından “Yeni vaka” ile ilk işinizi gönderin.",
      ],
      features: [
        { icon: "🦷", t: "Yeni vaka", d: "Diş şeması, ürün, renk, istenen teslim tarihi ve notlar; tarama ve fotoğraf yükleme." },
        { icon: "📍", t: "Vaka takibi", d: "Alındı › tasarım › üretim › kalite › kargo › teslim aşamaları canlı." },
        { icon: "💬", t: "Mesajlar", d: "Vaka içinden teknisyenle yazışma, dosya alışverişi, 3D model görüntüleme." },
        { icon: "🚚", t: "Kargo", d: "Ölçü için kurye isteme, kargo bildirme, gelen ve giden paket takibi." },
        { icon: "🧾", t: "Cari hesap", d: "İşler, ekstre, faturalar ve proforma; PDF olarak indirme." },
        { icon: "🏷", t: "Fiyat listesi", d: "Talep ettiğinizde açılır; güncel ürün fiyatları." },
        { icon: "👥", t: "Ekip", d: "Asistanınızı ya da ortağınızı davet koduyla hesabınıza ekleyin." },
        { icon: "🔔", t: "Bildirimler", d: "Durum değişikliği, mesaj ve laboratuvar duyuruları tek listede." },
      ],
      faq: [
        { q: "Hesabım ne zaman onaylanır?", a: "Genellikle aynı iş günü içinde. Acil bir vakanız varsa bizi arayın, hemen onaylayalım." },
        { q: "Hangi dosyaları yükleyebilirim?", a: "STL, PLY, OBJ tarama dosyaları, fotoğraflar ve PDF reçete. Dosya başına 50 MB'a kadar." },
        { q: "Fiziksel ölçü gönderebilir miyim?", a: "Evet. Vakayı açın, ardından “Kargo” bölümünden kurye isteyin ya da kargo takip numarasını girin." },
        { q: "Hasta adını yazmam gerekiyor mu?", a: "Hayır. KVKK gereği hasta adı yerine baş harfler ya da kendi kayıt numaranızı (ör. AY-104) kullanın." },
        { q: "Asistanım da giriş yapabilir mi?", a: "Evet. “Ekip” sayfasından bir davet kodu oluşturun; asistanınız kayıt olurken bu kodu girer." },
      ],
      guide: insertAfter(COMMON_GUIDE_TR("Hekim (Türkiye)"), "account", [{ screen: "team", title: "Ekibinizi ekleyin", caption: "Asistanınıza davet kodu verin; aynı vakaları birlikte yönetin." }]),
    },
    doctor_foreign: {
      label: "Hekim (yurtdışı)", short: "Yabancı hekim",
      who: "Türkiye dışında çalışan diş hekimleri. Portal Türkçe, İngilizce ve Fransızca kullanılabilir.",
      steps: [
        "“Ücretsiz hesap aç” düğmesine tıklayın; formun üstünden dilinizi (Türkçe, English, Français) seçin.",
        "Hesap türü olarak “Hekim (yurtdışı)” seçin; ülkenizi, şehrinizi, telefonunuzu, e-posta ve şifrenizi yazın.",
        "E-postanıza gelen bağlantıyla adresinizi doğrulayın.",
        "Laboratuvarımız hesabınızı onaylar ve sizinle kendi dilinizde iletişime geçer.",
        "“Profil”de teslimat adresinizi, fatura bilgilerinizi (vergi / KDV no) ve tercih ettiğiniz kargo firmasını girin; ilk vakanızı gönderin.",
      ],
      features: [
        { icon: "🌍", t: "Kendi dilinizde", d: "Portal, bildirimler ve belgeler Türkçe, İngilizce veya Fransızca." },
        { icon: "🦷", t: "Dijital vaka", d: "Ağız içi taramanızı yükleyin; tasarım ve üretim İzmir'de." },
        { icon: "📍", t: "Canlı takip", d: "Her aşama ve uluslararası kargo takip numarası ekranda." },
        { icon: "📄", t: "Uygunluk beyanı", d: "Kargoya verilen her vaka için ısmarlama cihaz uygunluk beyanı (MDR Ek XIII) yazdırılabilir." },
        { icon: "💬", t: "Mesajlar", d: "Teknisyenle vaka içinden yazışma ve 3D model görüntüleme." },
        { icon: "🧾", t: "Hesap ve faturalar", d: "Ekstre, fatura ve proforma; fiyatlar TL veya EUR." },
      ],
      faq: [
        { q: "Teslim süresi ne kadar?", a: "Ürüne ve ülkeye göre değişir. Sitedeki “Teslim süresi” sayfasından ülkenizi seçerek tahmini tarihi görebilirsiniz." },
        { q: "Gümrük için belge gerekiyor mu?", a: "Her gönderide fatura ve uygunluk beyanı hazırlanır; portaldan da yazdırabilirsiniz." },
        { q: "Hangi kargo firmalarıyla çalışıyorsunuz?", a: "DHL, UPS ve diğer uluslararası firmalar. Profilinizde tercih ettiğiniz firmayı seçebilirsiniz." },
        { q: "Portalın dilini sonradan değiştirebilir miyim?", a: "Evet. “Profil” sayfasından dil tercihinizi değiştirebilirsiniz." },
      ],
      guide: insertAfter(COMMON_GUIDE_TR("Hekim (yurtdışı)"), "account", [{ screen: "declaration", title: "Uygunluk beyanı", caption: "Kargoya verilen vakanın beyanını tek tıkla yazdırın; gümrük için hazır." }]),
    },
    clinic: {
      label: "Klinik", short: "Klinik",
      who: "Birden fazla hekimin çalıştığı klinik, poliklinik ve ağız-diş sağlığı merkezleri.",
      steps: [
        "“Ücretsiz hesap aç” düğmesine tıklayın ve hesap türü olarak “Klinik” seçin.",
        "Kurum adı olarak kliniğinizin adını, ad soyad olarak hesap yöneticisini yazın; iletişim bilgilerini ve şifreyi girin.",
        "E-postanızı doğrulayın; laboratuvarımız hesabı onaylar ve kliniğiniz için tek bir cari hesap açılır.",
        "“Ekip” sayfasından davet kodu oluşturun; hekim ve asistanlarınız kayıt olurken bu kodu girerek kliniğe katılır.",
        "“Müşteriler” bölümüne klinikteki hekimleri ekleyin; her vakayı doğru hekim adına açın.",
      ],
      features: [
        { icon: "🏥", t: "Tek klinik hesabı", d: "Tüm hekimlerin vakaları tek listede; tek cari hesap ve fatura." },
        { icon: "👥", t: "Ekip ve roller", d: "Davet koduyla hekim ve asistan ekleme; yönetici ve üye rolleri." },
        { icon: "🩺", t: "Hekim bazında vaka", d: "Her vakayı “Müşteriler”deki hekim adına açın, kimin işi olduğu karışmasın." },
        { icon: "📍", t: "Canlı takip", d: "Tüm vakaların aşaması, teslim tarihi ve kargo bilgisi." },
        { icon: "🚚", t: "Kargo", d: "Toplu ölçü gönderimi için kurye isteme, paket takibi." },
        { icon: "🖼", t: "Logo ve profil", d: "Klinik logonuz belgelerde ve portalda görünür." },
      ],
      faq: [
        { q: "Her hekim ayrı hesap mı açmalı?", a: "Hayır. Klinik hesabını bir kez açın, hekimleri davet koduyla ekleyin. Hepsi aynı hesabı kullanır." },
        { q: "Bir hekim klinikten ayrılırsa?", a: "“Ekip” sayfasından üyeliğini kaldırın; geçmiş vakalar klinik hesabında kalır." },
        { q: "Faturalar kimin adına kesilir?", a: "Profilde girdiğiniz klinik fatura unvanına. İsterseniz vaka bazında hekim adı da belgelerde yer alır." },
      ],
      guide: insertAfter(COMMON_GUIDE_TR("Klinik"), "profile", [
        { screen: "team", title: "Hekimlerinizi davet edin", caption: "Ekip sayfasında davet kodu oluşturun; hekimler bu kodla kliniğe katılır." },
        { screen: "clients", title: "Hekimleri tanımlayın", caption: "Müşteriler bölümüne klinikteki hekimleri ekleyin; vakayı açarken seçin." },
      ]),
    },
    agency: {
      label: "Aracı kuruluş", short: "Aracı kuruluş",
      who: "Birden çok hekim ya da kliniğin işini laboratuvarımıza ileten aracı firmalar, temsilciler ve dental depolar.",
      steps: [
        "“Ücretsiz hesap aç” düğmesine tıklayın ve hesap türü olarak “Aracı kuruluş” seçin.",
        "Firma adınızı, yetkili kişiyi, ülke, şehir ve iletişim bilgilerinizi girin; şifre belirleyin.",
        "E-postanızı doğrulayın; laboratuvarımız hesabınızı onaylar ve firmanız için cari hesap açılır.",
        "“Müşteriler” bölümüne çalıştığınız hekim ve klinikleri ekleyin.",
        "Her vakayı ilgili müşteriniz adına açın; ekibinizi davet koduyla hesaba ekleyin.",
      ],
      features: [
        { icon: "🤝", t: "Müşteri listesi", d: "Çalıştığınız hekim ve klinikleri bir kez tanımlayın, her vakada seçin." },
        { icon: "🗂", t: "Tüm vakalar tek ekranda", d: "Müşterilerinizin bütün işleri, aşamaları ve teslim tarihleri." },
        { icon: "📄", t: "Müşteri adına belge", d: "Uygunluk beyanında vakanın müşteri bilgisi yer alır." },
        { icon: "🚚", t: "Toplu kargo", d: "Birden çok vakanın ölçüsünü tek kuryeyle gönderin, paketleri izleyin." },
        { icon: "🧾", t: "Cari ekstre", d: "Firmanızın tüm işleri, ekstre, fatura ve proforma." },
        { icon: "👥", t: "Ekip", d: "Çalışanlarınızı davet koduyla ekleyin; herkes aynı vakaları görür." },
      ],
      faq: [
        { q: "Müşterim de portalı görebilir mi?", a: "Müşterileriniz sizin hesabınıza bağlı kayıtlardır; portala giriş yapmazlar. Bilgilendirmeyi siz yaparsınız." },
        { q: "Fiyatlar nasıl belirlenir?", a: "Aracı kuruluşlara özel fiyat listesi tanımlanır. “Fiyat listesi” sayfasından talep edebilirsiniz." },
        { q: "Bir vakayı başka müşteriye taşıyabilir miyim?", a: "Yanlış müşteri seçtiyseniz vaka içinden laboratuvara yazın, düzeltelim." },
      ],
      guide: insertAfter(COMMON_GUIDE_TR("Aracı kuruluş"), "profile", [{ screen: "clients", title: "Müşterilerinizi ekleyin", caption: "Çalıştığınız hekim ve klinikleri tanımlayın; her vakayı müşteri adına açın." }]),
    },
  },
  mock: {
    email: "E-posta", password: "Şifre", name: "Ad soyad", company: "Kurum", country: "Ülke", phone: "Telefon", create: "Hesap aç", type: "Hesap türü",
    inbox: "Gelen kutusu", verifySubj: "MB Dental · E-posta adresinizi doğrulayın", verifyBtn: "Adresimi doğrula",
    pending: "Başvurunuz inceleniyor", approved: "Hesabınız onaylandı", profile: "Profil", delivery: "Teslimat adresi", invoice: "Fatura unvanı", shade: "Renk sistemi", carrier: "Kargo firması", save: "Kaydet",
    newCase: "Yeni vaka", patient: "Hasta kodu", product: "Ürün", productVal: "Zirkonyum kron", teeth: "Dişler", shadeLbl: "Renk", due: "Teslim", send: "Gönder",
    drop: "Dosyaları buraya bırakın", files: "Dosyalar",
    stages: "Alındı|Tasarım|Üretim|Kalite|Kargoda|Teslim", caseNo: "Vaka", chatQ: "Kenar hattını biraz uzatabilir misiniz?", chatA: "Tabii, tasarımı güncelledim. Onayınıza sundum.",
    courier: "Kurye iste", tracking: "Takip no", parcel: "Paket", onWay: "Yolda",
    statement: "Cari ekstre", invoiceRow: "Fatura", balance: "Bakiye", download: "PDF indir",
    team: "Ekip", inviteCode: "Davet kodu", member: "Üye", admin: "Yönetici",
    clients: "Müşteriler", addClient: "Müşteri ekle", decl: "Uygunluk beyanı", print: "Yazdır",
  },
};

const EN: HelpUI = {
  meta: { title: "Help centre: account setup and portal guide", description: "How dentists, dentists abroad, clinics and agencies open an account on the MB Dental portal, send cases, track, ship and pay; videos and what's new." },
  kicker: "Help centre",
  title: "Learn the portal in a few minutes",
  lead: "From opening an account to sending your first case, tracking and invoices — step by step. Pick the account type that fits you.",
  choose: "Your account type",
  openAccount: "Open a free account",
  signIn: "Sign in",
  stepsTitle: "How to open an account",
  featuresTitle: "What's in your panel",
  guideTitle: "Step-by-step walkthrough",
  guideLead: "Watch a short animation of how the portal works.",
  play: "Play",
  pause: "Pause",
  prev: "Previous step",
  next: "Next step",
  faqTitle: "Frequently asked",
  videosTitle: "How-to videos",
  videosLead: "Short videos prepared by our team.",
  updatesTitle: "What's new",
  updatesLead: "New features and changes in the portal.",
  updatesEmpty: "No announcements yet.",
  whyTitle: "Why send your cases through the portal?",
  why: [
    { icon: "⚡", t: "A case in 2 minutes", d: "No phone calls, chat messages or paper prescriptions. Fill in the form, drop your files, send." },
    { icon: "👁", t: "See every stage live", d: "Design, production or shipped? It is on screen without having to ask." },
    { icon: "🎯", t: "No room for errors", d: "Teeth, shade, product and files in one record — nothing gets lost or misread." },
    { icon: "📦", t: "Shipping and invoices in one place", d: "Book a courier, track parcels and download statements and invoices any time." },
  ],
  helpTitle: "Stuck somewhere?",
  helpText: "Our team will help you set up your account or send your first case.",
  contact: "Contact us",
  nav: "Help",
  types: {
    doctor_tr: {
      label: "Dentist (Türkiye)", short: "Dentist in Türkiye",
      who: "Dentists with a practice in Türkiye or working at a clinic there.",
      steps: [
        "Click “Open a free account” on this page, or “Sign in” › “Open an account” at the top of the site.",
        "Choose “Dentist (Türkiye)”, then enter your name, practice name, city, phone, e-mail and a password.",
        "Confirm your address with the link sent to your e-mail.",
        "Our lab approves your account (usually the same working day); your customer account is created automatically.",
        "Sign in, complete delivery and billing details under “Profile”, then send your first job with “New case”.",
      ],
      features: [
        { icon: "🦷", t: "New case", d: "Tooth chart, product, shade, delivery date and notes; upload scans and photos." },
        { icon: "📍", t: "Case tracking", d: "Received › design › production › quality › shipped › delivered, live." },
        { icon: "💬", t: "Messages", d: "Chat with the technician inside the case, exchange files, view 3D models." },
        { icon: "🚚", t: "Shipping", d: "Book a courier for impressions, announce parcels, track them." },
        { icon: "🧾", t: "Account", d: "Jobs, statement, invoices and pro forma as PDF." },
        { icon: "🏷", t: "Price list", d: "Opened on request; current product prices." },
        { icon: "👥", t: "Team", d: "Add your assistant or partner with an invitation code." },
        { icon: "🔔", t: "Notifications", d: "Status changes, messages and lab announcements in one list." },
      ],
      faq: [
        { q: "When is my account approved?", a: "Usually the same working day. For an urgent case, call us and we approve it right away." },
        { q: "Which files can I upload?", a: "STL, PLY and OBJ scans, photos and PDF prescriptions — up to 50 MB per file." },
        { q: "Can I send a physical impression?", a: "Yes. Open the case, then book a courier or enter the tracking number under “Shipping”." },
        { q: "Do I have to write the patient's name?", a: "No. Use initials or your own record number (e.g. AY-104) instead of the name." },
        { q: "Can my assistant sign in too?", a: "Yes. Create an invitation code on the “Team” page; your assistant enters it when signing up." },
      ],
      guide: insertAfter(COMMON_GUIDE_EN("Dentist (Türkiye)"), "account", [{ screen: "team", title: "Add your team", caption: "Give your assistant an invitation code and manage cases together." }]),
    },
    doctor_foreign: {
      label: "Dentist (international)", short: "Dentist abroad",
      who: "Dentists working outside Türkiye. The portal is available in Turkish, English and French.",
      steps: [
        "Click “Open a free account” and pick your language (Türkçe, English, Français) at the top of the form.",
        "Choose “Dentist (international)”, then enter your country, city, phone, e-mail and a password.",
        "Confirm your address with the link sent to your e-mail.",
        "Our lab approves your account and contacts you in your language.",
        "Under “Profile”, add your delivery address, billing details (VAT number) and preferred carrier, then send your first case.",
      ],
      features: [
        { icon: "🌍", t: "In your language", d: "Portal, notifications and documents in Turkish, English or French." },
        { icon: "🦷", t: "Digital cases", d: "Upload your intraoral scan; design and production in Izmir." },
        { icon: "📍", t: "Live tracking", d: "Every stage and the international tracking number on screen." },
        { icon: "📄", t: "Declaration of conformity", d: "Print the custom-made device declaration (MDR Annex XIII) for every shipped case." },
        { icon: "💬", t: "Messages", d: "Chat with the technician inside the case and view 3D models." },
        { icon: "🧾", t: "Account and invoices", d: "Statement, invoices and pro forma; prices in TRY or EUR." },
      ],
      faq: [
        { q: "How long does delivery take?", a: "It depends on the product and country. Choose your country on the “Delivery time” page to see an estimate." },
        { q: "Do I need documents for customs?", a: "An invoice and a declaration of conformity are prepared for every shipment; you can also print them from the portal." },
        { q: "Which carriers do you use?", a: "DHL, UPS and other international carriers. Choose your preferred one in your profile." },
        { q: "Can I change the portal language later?", a: "Yes, on the “Profile” page." },
      ],
      guide: insertAfter(COMMON_GUIDE_EN("Dentist (international)"), "account", [{ screen: "declaration", title: "Declaration of conformity", caption: "Print the declaration of a shipped case in one click — ready for customs." }]),
    },
    clinic: {
      label: "Clinic", short: "Clinic",
      who: "Clinics, polyclinics and dental centres with several dentists.",
      steps: [
        "Click “Open a free account” and choose “Clinic” as the account type.",
        "Enter your clinic's name as the organisation and the account manager's name; add contact details and a password.",
        "Confirm your e-mail; our lab approves the account and creates a single customer account for your clinic.",
        "On the “Team” page create an invitation code; your dentists and assistants enter it when signing up to join the clinic.",
        "Add the clinic's dentists under “Clients” and open each case in the right dentist's name.",
      ],
      features: [
        { icon: "🏥", t: "One clinic account", d: "All dentists' cases in one list; one statement and invoice." },
        { icon: "👥", t: "Team and roles", d: "Add dentists and assistants with an invitation code; admin and member roles." },
        { icon: "🩺", t: "Cases per dentist", d: "Open each case for a dentist from “Clients” so nothing gets mixed up." },
        { icon: "📍", t: "Live tracking", d: "Stage, delivery date and shipping of every case." },
        { icon: "🚚", t: "Shipping", d: "Book a courier for several impressions, track parcels." },
        { icon: "🖼", t: "Logo and profile", d: "Your clinic logo appears in the portal and on documents." },
      ],
      faq: [
        { q: "Does every dentist need an account?", a: "No. Open the clinic account once and add dentists with an invitation code; they all use the same account." },
        { q: "What if a dentist leaves?", a: "Remove them on the “Team” page; past cases stay in the clinic account." },
        { q: "Who are invoices issued to?", a: "To the clinic billing name in your profile. The dentist's name can also appear on case documents." },
      ],
      guide: insertAfter(COMMON_GUIDE_EN("Clinic"), "profile", [
        { screen: "team", title: "Invite your dentists", caption: "Create an invitation code on the Team page; dentists join the clinic with it." },
        { screen: "clients", title: "List your dentists", caption: "Add the clinic's dentists under Clients and pick one when opening a case." },
      ]),
    },
    agency: {
      label: "Agency / intermediary", short: "Agency",
      who: "Agencies, representatives and dental depots that bring several dentists' or clinics' work to our lab.",
      steps: [
        "Click “Open a free account” and choose “Agency / intermediary” as the account type.",
        "Enter your company name, contact person, country, city and contact details; set a password.",
        "Confirm your e-mail; our lab approves your account and creates a customer account for your company.",
        "Add the dentists and clinics you work with under “Clients”.",
        "Open each case in your client's name and add your staff with an invitation code.",
      ],
      features: [
        { icon: "🤝", t: "Client list", d: "Define the dentists and clinics you work with once and pick them for each case." },
        { icon: "🗂", t: "All cases on one screen", d: "Every client's jobs, stages and delivery dates." },
        { icon: "📄", t: "Documents per client", d: "The declaration of conformity shows the case's client." },
        { icon: "🚚", t: "Combined shipping", d: "Send impressions for several cases with one courier and track parcels." },
        { icon: "🧾", t: "Statement", d: "All your company's jobs, statement, invoices and pro forma." },
        { icon: "👥", t: "Team", d: "Add colleagues with an invitation code; everyone sees the same cases." },
      ],
      faq: [
        { q: "Can my clients see the portal?", a: "Clients are records under your account; they do not sign in. You keep them informed." },
        { q: "How are prices set?", a: "Agencies get a dedicated price list. Request it on the “Price list” page." },
        { q: "Can I move a case to another client?", a: "If you picked the wrong client, message the lab inside the case and we will fix it." },
      ],
      guide: insertAfter(COMMON_GUIDE_EN("Agency / intermediary"), "profile", [{ screen: "clients", title: "Add your clients", caption: "Define the dentists and clinics you work with; open each case in their name." }]),
    },
  },
  mock: {
    email: "E-mail", password: "Password", name: "Full name", company: "Organisation", country: "Country", phone: "Phone", create: "Create account", type: "Account type",
    inbox: "Inbox", verifySubj: "MB Dental · Confirm your e-mail address", verifyBtn: "Confirm my address",
    pending: "Your application is being reviewed", approved: "Your account is approved", profile: "Profile", delivery: "Delivery address", invoice: "Billing name", shade: "Shade system", carrier: "Carrier", save: "Save",
    newCase: "New case", patient: "Patient code", product: "Product", productVal: "Zirconia crown", teeth: "Teeth", shadeLbl: "Shade", due: "Delivery", send: "Send",
    drop: "Drop your files here", files: "Files",
    stages: "Received|Design|Production|Quality|Shipped|Delivered", caseNo: "Case", chatQ: "Could you extend the margin line a little?", chatA: "Sure, I've updated the design. It's ready for your approval.",
    courier: "Book a courier", tracking: "Tracking no", parcel: "Parcel", onWay: "In transit",
    statement: "Statement", invoiceRow: "Invoice", balance: "Balance", download: "Download PDF",
    team: "Team", inviteCode: "Invitation code", member: "Member", admin: "Admin",
    clients: "Clients", addClient: "Add client", decl: "Declaration of conformity", print: "Print",
  },
};

const FR: HelpUI = {
  meta: { title: "Centre d’aide : création de compte et utilisation du portail", description: "Comment les praticiens, praticiens hors Turquie, cabinets et intermédiaires ouvrent un compte sur le portail MB Dental, envoient, suivent, expédient et règlent leurs cas ; vidéos et nouveautés." },
  kicker: "Centre d’aide",
  title: "Maîtrisez le portail en quelques minutes",
  lead: "De l’ouverture du compte au premier cas, du suivi à la facture : tout, étape par étape. Choisissez le type de compte qui vous correspond.",
  choose: "Votre type de compte",
  openAccount: "Ouvrir un compte gratuit",
  signIn: "Connexion",
  stepsTitle: "Comment ouvrir un compte ?",
  featuresTitle: "Ce que contient votre espace",
  guideTitle: "Démonstration pas à pas",
  guideLead: "Regardez une courte animation du fonctionnement du portail.",
  play: "Lecture",
  pause: "Pause",
  prev: "Étape précédente",
  next: "Étape suivante",
  faqTitle: "Questions fréquentes",
  videosTitle: "Vidéos d’utilisation",
  videosLead: "De courtes vidéos préparées par notre équipe.",
  updatesTitle: "Nouveautés",
  updatesLead: "Nouvelles fonctions et changements du portail.",
  updatesEmpty: "Aucune annonce pour le moment.",
  whyTitle: "Pourquoi envoyer vos cas par le portail ?",
  why: [
    { icon: "⚡", t: "Un cas en 2 minutes", d: "Plus d’appels, de messages ni d’ordonnances papier. Remplissez le formulaire, déposez vos fichiers, envoyez." },
    { icon: "👁", t: "Chaque étape en direct", d: "Conception, fabrication ou expédié ? C’est à l’écran, sans avoir à demander." },
    { icon: "🎯", t: "Zéro risque d’erreur", d: "Dents, teinte, produit et fichiers dans une seule fiche : rien ne se perd." },
    { icon: "📦", t: "Expédition et factures au même endroit", d: "Demandez un coursier, suivez vos colis, téléchargez relevés et factures à tout moment." },
  ],
  helpTitle: "Besoin d’aide ?",
  helpText: "Notre équipe vous accompagne pour créer votre compte ou envoyer votre premier cas.",
  contact: "Nous contacter",
  nav: "Aide",
  types: {
    doctor_tr: {
      label: "Praticien (Turquie)", short: "Praticien en Turquie",
      who: "Chirurgiens-dentistes exerçant en Turquie, en cabinet ou en clinique.",
      steps: [
        "Cliquez sur « Ouvrir un compte gratuit » sur cette page, ou sur « Connexion » › « Créer un compte » en haut du site.",
        "Choisissez « Praticien (Turquie) », puis saisissez nom, cabinet, ville, téléphone, e-mail et mot de passe.",
        "Confirmez votre adresse grâce au lien reçu par e-mail.",
        "Notre laboratoire valide votre compte (généralement le jour ouvré même) ; votre compte client est créé automatiquement.",
        "Connectez-vous, complétez livraison et facturation dans « Profil », puis envoyez votre premier travail avec « Nouveau cas ».",
      ],
      features: [
        { icon: "🦷", t: "Nouveau cas", d: "Schéma dentaire, produit, teinte, date de livraison et notes ; scans et photos." },
        { icon: "📍", t: "Suivi", d: "Reçu › conception › fabrication › qualité › expédié › livré, en direct." },
        { icon: "💬", t: "Messages", d: "Échange avec le technicien dans le cas, fichiers et modèles 3D." },
        { icon: "🚚", t: "Expédition", d: "Coursier pour les empreintes, annonce et suivi des colis." },
        { icon: "🧾", t: "Compte", d: "Travaux, relevé, factures et proforma en PDF." },
        { icon: "🏷", t: "Liste de prix", d: "Ouverte sur demande ; prix à jour." },
        { icon: "👥", t: "Équipe", d: "Ajoutez votre assistant(e) ou associé avec un code d’invitation." },
        { icon: "🔔", t: "Notifications", d: "Changements d’état, messages et annonces du laboratoire." },
      ],
      faq: [
        { q: "Quand mon compte est-il validé ?", a: "Généralement le jour ouvré même. Pour un cas urgent, appelez-nous." },
        { q: "Quels fichiers puis-je envoyer ?", a: "Scans STL, PLY, OBJ, photos et ordonnances PDF — jusqu’à 50 Mo par fichier." },
        { q: "Puis-je envoyer une empreinte physique ?", a: "Oui. Ouvrez le cas, puis demandez un coursier ou saisissez le numéro de suivi dans « Expédition »." },
        { q: "Dois-je écrire le nom du patient ?", a: "Non. Utilisez des initiales ou votre propre numéro de dossier (ex. AY-104)." },
        { q: "Mon assistante peut-elle se connecter ?", a: "Oui. Créez un code d’invitation dans « Équipe » ; elle le saisit à l’inscription." },
      ],
      guide: insertAfter(COMMON_GUIDE_FR("Praticien (Turquie)"), "account", [{ screen: "team", title: "Ajoutez votre équipe", caption: "Donnez un code d’invitation à votre assistante et gérez les cas ensemble." }]),
    },
    doctor_foreign: {
      label: "Praticien (international)", short: "Praticien hors Turquie",
      who: "Chirurgiens-dentistes exerçant hors de Turquie. Le portail est disponible en turc, anglais et français.",
      steps: [
        "Cliquez sur « Ouvrir un compte gratuit » et choisissez votre langue (Türkçe, English, Français) en haut du formulaire.",
        "Choisissez « Praticien (international) », puis saisissez pays, ville, téléphone, e-mail et mot de passe.",
        "Confirmez votre adresse grâce au lien reçu par e-mail.",
        "Notre laboratoire valide votre compte et vous contacte dans votre langue.",
        "Dans « Profil », ajoutez adresse de livraison, facturation (n° de TVA) et transporteur, puis envoyez votre premier cas.",
      ],
      features: [
        { icon: "🌍", t: "Dans votre langue", d: "Portail, notifications et documents en turc, anglais ou français." },
        { icon: "🦷", t: "Cas numériques", d: "Téléversez votre scan intra-oral ; conception et fabrication à Izmir." },
        { icon: "📍", t: "Suivi en direct", d: "Chaque étape et le numéro de suivi international à l’écran." },
        { icon: "📄", t: "Déclaration de conformité", d: "Imprimez la déclaration de dispositif sur mesure (MDR annexe XIII) pour chaque cas expédié." },
        { icon: "💬", t: "Messages", d: "Échange avec le technicien et visualisation 3D." },
        { icon: "🧾", t: "Compte et factures", d: "Relevé, factures et proforma ; prix en TRY ou EUR." },
      ],
      faq: [
        { q: "Quel est le délai de livraison ?", a: "Il dépend du produit et du pays. Choisissez votre pays sur la page « Délai de livraison » pour une estimation." },
        { q: "Faut-il des documents pour la douane ?", a: "Une facture et une déclaration de conformité accompagnent chaque envoi ; vous pouvez aussi les imprimer depuis le portail." },
        { q: "Avec quels transporteurs travaillez-vous ?", a: "DHL, UPS et d’autres transporteurs internationaux. Choisissez le vôtre dans votre profil." },
        { q: "Puis-je changer la langue du portail ?", a: "Oui, dans la page « Profil »." },
      ],
      guide: insertAfter(COMMON_GUIDE_FR("Praticien (international)"), "account", [{ screen: "declaration", title: "Déclaration de conformité", caption: "Imprimez la déclaration d’un cas expédié en un clic, prête pour la douane." }]),
    },
    clinic: {
      label: "Clinique", short: "Cabinet de groupe",
      who: "Cabinets de groupe, cliniques et centres dentaires avec plusieurs praticiens.",
      steps: [
        "Cliquez sur « Ouvrir un compte gratuit » et choisissez « Clinique ».",
        "Saisissez le nom de la structure et celui du gestionnaire du compte, vos coordonnées et un mot de passe.",
        "Confirmez votre e-mail ; notre laboratoire valide le compte et crée un compte client unique pour votre structure.",
        "Dans « Équipe », créez un code d’invitation ; vos praticiens et assistantes le saisissent à l’inscription pour vous rejoindre.",
        "Ajoutez les praticiens dans « Clients » et ouvrez chaque cas au nom du bon praticien.",
      ],
      features: [
        { icon: "🏥", t: "Un seul compte", d: "Les cas de tous les praticiens dans une liste ; un relevé et une facture." },
        { icon: "👥", t: "Équipe et rôles", d: "Ajout par code d’invitation ; rôles administrateur et membre." },
        { icon: "🩺", t: "Cas par praticien", d: "Ouvrez chaque cas au nom d’un praticien de « Clients »." },
        { icon: "📍", t: "Suivi en direct", d: "Étape, date de livraison et expédition de chaque cas." },
        { icon: "🚚", t: "Expédition", d: "Coursier pour plusieurs empreintes, suivi des colis." },
        { icon: "🖼", t: "Logo et profil", d: "Votre logo apparaît dans le portail et sur les documents." },
      ],
      faq: [
        { q: "Chaque praticien doit-il ouvrir un compte ?", a: "Non. Ouvrez le compte une fois et ajoutez les praticiens par code d’invitation." },
        { q: "Et si un praticien part ?", a: "Retirez-le dans « Équipe » ; ses cas restent dans le compte de la structure." },
        { q: "À qui sont adressées les factures ?", a: "À la raison sociale saisie dans le profil. Le nom du praticien peut aussi figurer sur les documents du cas." },
      ],
      guide: insertAfter(COMMON_GUIDE_FR("Clinique"), "profile", [
        { screen: "team", title: "Invitez vos praticiens", caption: "Créez un code d’invitation dans Équipe ; les praticiens rejoignent la structure avec ce code." },
        { screen: "clients", title: "Listez vos praticiens", caption: "Ajoutez-les dans Clients et choisissez-en un à l’ouverture du cas." },
      ]),
    },
    agency: {
      label: "Intermédiaire", short: "Intermédiaire",
      who: "Intermédiaires, représentants et dépôts dentaires qui confient à notre laboratoire les travaux de plusieurs praticiens ou cabinets.",
      steps: [
        "Cliquez sur « Ouvrir un compte gratuit » et choisissez « Intermédiaire ».",
        "Saisissez le nom de votre société, le contact, pays, ville et coordonnées ; choisissez un mot de passe.",
        "Confirmez votre e-mail ; notre laboratoire valide le compte et crée un compte client pour votre société.",
        "Ajoutez dans « Clients » les praticiens et cabinets avec lesquels vous travaillez.",
        "Ouvrez chaque cas au nom du client concerné et invitez vos collaborateurs avec un code.",
      ],
      features: [
        { icon: "🤝", t: "Liste de clients", d: "Définissez une fois vos praticiens et cabinets, choisissez-les à chaque cas." },
        { icon: "🗂", t: "Tous les cas sur un écran", d: "Travaux, étapes et dates de livraison de tous vos clients." },
        { icon: "📄", t: "Documents par client", d: "La déclaration de conformité indique le client du cas." },
        { icon: "🚚", t: "Expédition groupée", d: "Un seul coursier pour plusieurs empreintes, suivi des colis." },
        { icon: "🧾", t: "Relevé", d: "Tous les travaux, relevé, factures et proforma de votre société." },
        { icon: "👥", t: "Équipe", d: "Ajoutez vos collaborateurs par code d’invitation." },
      ],
      faq: [
        { q: "Mes clients voient-ils le portail ?", a: "Vos clients sont des fiches rattachées à votre compte ; ils ne se connectent pas." },
        { q: "Comment les prix sont-ils fixés ?", a: "Une liste de prix dédiée aux intermédiaires ; demandez-la dans « Liste de prix »." },
        { q: "Puis-je changer le client d’un cas ?", a: "En cas d’erreur, écrivez au laboratoire dans le cas et nous corrigeons." },
      ],
      guide: insertAfter(COMMON_GUIDE_FR("Intermédiaire"), "profile", [{ screen: "clients", title: "Ajoutez vos clients", caption: "Définissez vos praticiens et cabinets ; ouvrez chaque cas à leur nom." }]),
    },
  },
  mock: {
    email: "E-mail", password: "Mot de passe", name: "Nom complet", company: "Structure", country: "Pays", phone: "Téléphone", create: "Créer le compte", type: "Type de compte",
    inbox: "Boîte de réception", verifySubj: "MB Dental · Confirmez votre adresse e-mail", verifyBtn: "Confirmer mon adresse",
    pending: "Votre demande est en cours d’examen", approved: "Votre compte est validé", profile: "Profil", delivery: "Adresse de livraison", invoice: "Raison sociale", shade: "Teintier", carrier: "Transporteur", save: "Enregistrer",
    newCase: "Nouveau cas", patient: "Code patient", product: "Produit", productVal: "Couronne zircone", teeth: "Dents", shadeLbl: "Teinte", due: "Livraison", send: "Envoyer",
    drop: "Déposez vos fichiers ici", files: "Fichiers",
    stages: "Reçu|Conception|Fabrication|Qualité|Expédié|Livré", caseNo: "Cas", chatQ: "Pouvez-vous prolonger un peu la limite cervicale ?", chatA: "Bien sûr, j’ai mis à jour la conception. Elle attend votre validation.",
    courier: "Demander un coursier", tracking: "N° de suivi", parcel: "Colis", onWay: "En route",
    statement: "Relevé", invoiceRow: "Facture", balance: "Solde", download: "Télécharger PDF",
    team: "Équipe", inviteCode: "Code d’invitation", member: "Membre", admin: "Administrateur",
    clients: "Clients", addClient: "Ajouter un client", decl: "Déclaration de conformité", print: "Imprimer",
  },
};

export const HELP_UI: Record<Locale, HelpUI> = { tr: TR, en: EN, fr: FR };
