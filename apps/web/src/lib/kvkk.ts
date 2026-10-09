/**
 * KVKK yardımcıları: örnek aydınlatma metinleri, saklama süreleri, veri envanteri, erişim kaydı.
 * Metinler başlangıç şablonudur; şirketin avukatı / KVKK danışmanı tarafından gözden geçirilmelidir.
 */
import type { createClient } from "@/lib/supabase/server";

type SB = Awaited<ReturnType<typeof createClient>>;

/** Hassas veri erişimini kaydeder (hata olursa akışı bozmaz) */
export async function logAccess(sb: SB, companyId: string, userId: string, action: "view" | "reveal" | "download" | "export", entity: string, entityId?: string | null, detail?: string) {
  try {
    await sb.from("kvkk_access_log").insert({ company_id: companyId, user_id: userId, action, entity, entity_id: entityId ?? null, detail: detail?.slice(0, 300) ?? null });
  } catch {
    /* tablo yoksa (SQL çalıştırılmadıysa) sessiz geç */
  }
}

export const maskTc = (v?: string | null) => (v ? `${v.slice(0, 2)}${"•".repeat(Math.max(0, v.length - 4))}${v.slice(-2)}` : "—");
export const maskIban = (v?: string | null) => (v ? `${v.slice(0, 4)} •••• •••• •••• ${v.slice(-4)}` : "—");
export const maskPhone = (v?: string | null) => (v ? `${v.slice(0, 4)} ••• •• ${v.slice(-2)}` : "—");

export const REQUEST_TYPES: Record<string, string> = {
  bilgi: "Verimin işlenip işlenmediğini öğrenme / bilgi talebi", erisim: "İşlenen verilerimin bir kopyası", duzeltme: "Eksik / yanlış verinin düzeltilmesi",
  silme: "Verilerimin silinmesi / yok edilmesi", itiraz: "Otomatik sonuca itiraz", aktarim: "Aktarıldığı üçüncü kişilerin bildirilmesi", tazmin: "Zararın giderilmesi", diger: "Diğer",
};

export function employeeNotice(company: { name: string; address?: string | null; email?: string | null }) {
  return `${company.name} ("Şirket") olarak, 6698 sayılı Kişisel Verilerin Korunması Kanunu ("KVKK") uyarınca veri sorumlusu sıfatıyla, çalışanlarımıza ait kişisel verileri aşağıda açıklanan kapsamda işlemekteyiz.

1. İşlenen veriler: Kimlik (ad soyad, TC kimlik no, doğum tarihi), iletişim (telefon, adres, e-posta), özlük (işe giriş-çıkış, görev, bölüm, eğitim, askerlik, sözleşmeler), finans (ücret, IBAN, avans, icra-nafaka kesintileri, BES), çalışma süresi (PDKS kart okutmaları, mobil uygulamadan giriş-çıkış sırasında konum), mesleki deneyim ve performans değerlendirmeleri, iş sağlığı ve güvenliği kayıtları ile özel nitelikli veri olarak sağlık raporları ve işe giriş / periyodik muayene sonuçları, adli sicil kaydı (mevzuatın gerektirdiği hâllerde).

2. İşleme amaçları: İş sözleşmesinin kurulması ve ifası, ücret ve bordro süreçleri, SGK ve vergi bildirimleri, çalışma süresinin takibi, iş sağlığı ve güvenliği yükümlülükleri, yasal saklama ve denetim yükümlülükleri, performans ve kariyer süreçleri, şirket içi iletişim, hukuki uyuşmazlıkların yönetimi.

3. Hukuki sebepler (KVKK md. 5 ve 6): Kanunlarda açıkça öngörülmesi (4857 sayılı İş Kanunu, 5510 sayılı Kanun, 6331 sayılı İSG Kanunu, vergi mevzuatı), sözleşmenin kurulması ve ifası, hukuki yükümlülüğün yerine getirilmesi, bir hakkın tesisi, kullanılması veya korunması, temel hak ve özgürlüklerinize zarar vermemek kaydıyla meşru menfaat; sağlık verileri için iş sağlığı ve güvenliği ile sosyal güvenlik alanındaki hukuki yükümlülükler.

4. Aktarım: Kişisel verileriniz yalnızca yukarıdaki amaçlarla; SGK, Gelir İdaresi, İŞKUR ve diğer yetkili kamu kurumlarına, ücret ödemesi yapılan bankaya, BES şirketine, icra dairelerine, mali müşavirimize, iş sağlığı ve güvenliği hizmeti aldığımız OSGB ve işyeri hekimine ve hizmet aldığımız yazılım / sunucu sağlayıcılarına aktarılabilir. Yazılım altyapısının sunucuları yurt dışında bulunabilir; bu aktarım KVKK md. 9 kapsamında standart sözleşme ile yapılır.

5. Toplama yöntemi: İşe giriş formları, kimlik ve e-Devlet belgeleri, PDKS cihazları, mobil uygulama ve yazılı / elektronik başvurular.

6. Saklama süresi: Verileriniz ilgili mevzuatta öngörülen süreler (ör. özlük ve bordro kayıtları için iş ilişkisinin bitiminden itibaren 10 yıl, sağlık kayıtları için 15 yıl) boyunca saklanır, süre sonunda silinir, yok edilir veya anonim hâle getirilir.

7. Haklarınız (KVKK md. 11): Verilerinizin işlenip işlenmediğini öğrenme, bilgi talep etme, amacına uygun kullanılıp kullanılmadığını öğrenme, aktarıldığı kişileri bilme, düzeltilmesini, silinmesini isteme, otomatik sistemlerle aleyhinize çıkan sonuca itiraz etme ve zararın giderilmesini talep etme haklarına sahipsiniz. Başvurularınızı mobil uygulamadaki "KVKK" sayfasından ya da ${company.address ? `${company.address} adresine yazılı olarak` : "şirket adresine yazılı olarak"}${company.email ? ` veya ${company.email} adresine` : ""} iletebilirsiniz. Başvurular en geç 30 gün içinde ücretsiz olarak sonuçlandırılır.`;
}

export function candidateNotice(company: { name: string }) {
  return `${company.name} olarak iş başvurunuz kapsamında ad soyad, iletişim, doğum tarihi, eğitim, deneyim, beklenen ücret, özgeçmiş ve iş örneklerinizi; işe alım sürecinin yürütülmesi, sizinle iletişime geçilmesi ve uygun pozisyonların değerlendirilmesi amacıyla, KVKK md. 5/2-c (sözleşmenin kurulması) ve md. 5/2-f (meşru menfaat) hukuki sebeplerine dayanarak işliyoruz. Verileriniz işe alım ekibimiz dışında paylaşılmaz; yazılım altyapısı için hizmet sağlayıcılara (sunucuları yurt dışında olabilir) standart sözleşme ile aktarılır. Değerlendirme olumsuz sonuçlanırsa verileriniz 6 ay, aday havuzunda kalmayı kabul ederseniz 1 yıl sonra silinir. KVKK md. 11'deki haklarınız için başvuru takip sayfanızdaki "KVKK başvurusu" bağlantısını kullanabilirsiniz.`;
}

export const CONSENT_PURPOSES: Array<{ key: string; title: string; body: string }> = [
  { key: "foto_paylasim", title: "Fotoğraf ve videolarımın paylaşılması", body: "Etkinlik ve çalışma ortamında çekilen fotoğraf / videolarımın şirketin web sitesinde, sosyal medya hesaplarında ve tanıtım materyallerinde kullanılmasına açık rıza veriyorum. Bu rızayı istediğim zaman geri alabilirim; geri almam iş ilişkimi etkilemez." },
  { key: "ozel_gun", title: "Doğum günümün duyurulması", body: "Doğum günümün şirket içi iletişim kanallarında (uygulama, duyuru) çalışma arkadaşlarımla paylaşılmasına açık rıza veriyorum. İstediğim zaman geri alabilirim." },
];

export const RETENTION_DEFAULTS: Array<{ category: string; data: string; legal_basis: string; retention: string; years: number | null; action: string }> = [
  { category: "Özlük dosyası", data: "Kimlik, iletişim, sözleşmeler, e-Devlet belgeleri, işe giriş formları", legal_basis: "İş K. md. 75, TBK md. 146 (10 yıl zamanaşımı)", retention: "İş ilişkisi bitiminden itibaren 10 yıl", years: 10, action: "Anonimleştirme + belge imhası" },
  { category: "Bordro ve ücret", data: "Ücret, bordro, avans, banka ödemeleri, BES, icra kesintileri", legal_basis: "VUK md. 253 (5 yıl), İş K. md. 32 ve TBK (10 yıl)", retention: "İlgili yılı izleyen 10 yıl", years: 10, action: "Anonimleştirme" },
  { category: "Puantaj (PDKS)", data: "Kart okutmaları, mobil konumlu okutmalar, fazla mesai", legal_basis: "İş K. md. 32 (ücret alacağı zamanaşımı 5 yıl), meşru menfaat", retention: "Kayıt tarihinden itibaren 5 yıl; mobil konum ayrıntısı 1 yıl", years: 5, action: "Silme (konum alanları 1 yılda)" },
  { category: "Sağlık ve İSG", data: "İşe giriş / periyodik muayene, raporlar, İSG eğitim kayıtları", legal_basis: "6331 sayılı İSG K., İş Sağlığı Hizmetleri Yönetmeliği", retention: "İş ilişkisi bitiminden itibaren 15 yıl", years: 15, action: "Belge imhası" },
  { category: "Aday başvuruları", data: "Başvuru formu, özgeçmiş, mülakat notları", legal_basis: "KVKK md. 5/2-c, 5/2-f", retention: "Süreç bitiminden 6 ay (havuz onayı varsa 1 yıl)", years: 0.5, action: "Otomatik silme (günlük)" },
  { category: "İletişim ve duyurular", data: "Mesajlar, duyuru okuma, anket ve etkinlik katılımı", legal_basis: "Meşru menfaat", retention: "2 yıl", years: 2, action: "Silme" },
  { category: "Erişim kayıtları (log)", data: "Hassas veri görüntüleme / indirme kayıtları", legal_basis: "KVKK md. 12 (teknik tedbir)", retention: "2 yıl", years: 2, action: "Silme" },
];

export const DATA_INVENTORY: Array<{ category: string; examples: string; subjects: string; purpose: string; basis: string; recipients: string; special?: boolean }> = [
  { category: "Kimlik", examples: "Ad soyad, TC kimlik no, doğum tarihi/yeri, anne-baba adı", subjects: "Çalışan, aday", purpose: "Sözleşme, SGK bildirimi", basis: "Kanun, sözleşme", recipients: "SGK, GİB, banka, mali müşavir" },
  { category: "İletişim", examples: "Telefon, adres, e-posta, acil durum kişisi", subjects: "Çalışan, aday", purpose: "İletişim, acil durum", basis: "Sözleşme, meşru menfaat", recipients: "—" },
  { category: "Özlük", examples: "Görev, bölüm, eğitim, askerlik, sözleşmeler, performans", subjects: "Çalışan", purpose: "İnsan kaynakları süreçleri", basis: "Kanun, sözleşme", recipients: "İŞKUR, SGK" },
  { category: "Finans", examples: "Ücret, IBAN, avans, icra-nafaka, BES", subjects: "Çalışan", purpose: "Ücret ödemesi, yasal kesintiler", basis: "Kanun, sözleşme", recipients: "Banka, BES şirketi, icra daireleri, mali müşavir" },
  { category: "Çalışma süresi ve konum", examples: "PDKS okutmaları, mobil okutmada konum", subjects: "Çalışan", purpose: "Puantaj, fazla mesai", basis: "Sözleşme, kanun, meşru menfaat", recipients: "—" },
  { category: "Sağlık (özel nitelikli)", examples: "Muayene sonuçları, raporlar, engellilik", subjects: "Çalışan", purpose: "İSG ve sosyal güvenlik yükümlülükleri", basis: "KVKK md. 6/3 (İSG, sosyal güvenlik)", recipients: "OSGB, işyeri hekimi, SGK", special: true },
  { category: "Ceza mahkûmiyeti (özel nitelikli)", examples: "Adli sicil kaydı", subjects: "Çalışan", purpose: "Mevzuatın gerektirdiği hâllerde işe alım", basis: "KVKK md. 6/3 (kanunda öngörülme)", recipients: "—", special: true },
  { category: "Görsel", examples: "Vesikalık fotoğraf, etkinlik fotoğrafları", subjects: "Çalışan", purpose: "Kimlik kartı, kurumsal iletişim", basis: "Sözleşme; tanıtım için açık rıza", recipients: "—" },
  { category: "Aday bilgileri", examples: "Özgeçmiş, deneyim, beklenen ücret, iş örnekleri", subjects: "Aday", purpose: "İşe alım", basis: "Sözleşmenin kurulması, meşru menfaat", recipients: "—" },
];

export const CHECKLIST: Array<{ key: string; title: string; hint: string }> = [
  { key: "verbis", title: "VERBİS kaydı yapıldı", hint: "50'den fazla çalışanı olan veri sorumluları VERBİS'e kayıt olmak zorundadır (verbis.kvkk.gov.tr). Bu sayfadaki veri envanteri kayıtta kullanılabilir." },
  { key: "aydinlatma", title: "Tüm çalışanlar aydınlatma metnini okudu", hint: "Mobil uygulamadan onay alınır; uygulaması olmayanlara imzalı form (kayıt sihirbazındaki KVKK formu)." },
  { key: "aday", title: "Kariyer sayfasında aday aydınlatma metni yayında", hint: "Başvuru formunda KVKK onayı zorunludur; metin aşağıdan düzenlenir." },
  { key: "envanter", title: "Kişisel veri işleme envanteri hazırlandı", hint: "Aşağıdaki envanter başlangıç noktasıdır; eksik süreçleri ekleyin." },
  { key: "politika", title: "Saklama ve imha politikası yazıldı, 6 ayda bir periyodik imha yapılıyor", hint: "Kişisel Verilerin Silinmesi Yönetmeliği md. 11: periyodik imha en geç 6 ayda bir." },
  { key: "yurtdisi", title: "Yurt dışı aktarım için standart sözleşme imzalandı ve Kurul'a bildirildi", hint: "Yazılım sunucuları (Supabase, Vercel) yurt dışındaysa KVKK md. 9: standart sözleşme imzadan itibaren 5 iş günü içinde Kurul'a bildirilir." },
  { key: "yetki", title: "Erişim yetkileri sınırlandı", hint: "Şefler yalnız kendi bölümünü, yalnız sahip/muhasebe ücretleri görür; erişim kayıtları tutulur." },
  { key: "ihlal", title: "Veri ihlali müdahale prosedürü var", hint: "İhlal öğrenildikten sonra en geç 72 saat içinde Kurul'a, makul sürede ilgililere bildirim." },
  { key: "egitim", title: "Çalışanlara KVKK farkındalık eğitimi verildi", hint: "Özellikle İK, muhasebe ve şeflere." },
];
