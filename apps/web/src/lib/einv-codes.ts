/**
 * GİB UBL-TR kod listeleri (e-Fatura / e-Arşiv / e-İrsaliye) — UBL-TR Kod Listeleri Kılavuzu v1.42 (01.04.2026) ve sonrası.
 * Bu laboratuvarın kullandığı senaryo ve tipler; sektöre özel olanlar (HKS, ENERJİ, İDİS, YTB, SGK, özel matrah, konaklama) dışarıda.
 */

export const EINV_PROFILES: Record<string, { label: string; kind: "efatura" | "earsiv" | "paper"; hint: string }> = {
  TICARIFATURA: { label: "e-Fatura · ticari", kind: "efatura", hint: "Alıcı 8 gün içinde kabul / red yanıtı verebilir" },
  TEMELFATURA: { label: "e-Fatura · temel", kind: "efatura", hint: "Yanıt beklenmez; iade faturası bu senaryoda kesilir" },
  EARSIVFATURA: { label: "e-Arşiv fatura", kind: "earsiv", hint: "Alıcı e-Fatura mükellefi değilse (kişi, yurt dışı, mikro ihracat)" },
  IHRACAT: { label: "İhracat (gümrük beyannameli)", kind: "efatura", hint: "Gümrük Bakanlığına gider; GTİP, teslim şartı, kap bilgisi zorunlu" },
  KAMU: { label: "Kamu", kind: "efatura", hint: "Kamu kurumuna satış; IBAN zorunlu" },
  ILAC_TIBBICIHAZ: { label: "İlaç / tıbbi cihaz", kind: "efatura", hint: "ÜTS kayıtlı ürün satışı; her satıra ürün tanımlayıcı" },
  KAGIT: { label: "Kâğıt fatura", kind: "paper", hint: "Elektronik gönderilmez" },
};

export const EINV_TYPES: Record<string, string> = {
  SATIS: "Satış", IADE: "İade", TEVKIFAT: "Tevkifatlı", ISTISNA: "İstisna", IHRACKAYITLI: "İhraç kayıtlı",
};

/** Senaryo → izin verilen tipler (GİB schematron) */
export const PROFILE_TYPES: Record<string, string[]> = {
  TEMELFATURA: ["SATIS", "IADE", "TEVKIFAT", "ISTISNA", "IHRACKAYITLI"],
  TICARIFATURA: ["SATIS", "TEVKIFAT", "ISTISNA", "IHRACKAYITLI"],
  EARSIVFATURA: ["SATIS", "IADE", "TEVKIFAT", "ISTISNA", "IHRACKAYITLI"],
  IHRACAT: ["ISTISNA"],
  KAMU: ["SATIS", "IADE", "TEVKIFAT", "ISTISNA", "IHRACKAYITLI"],
  ILAC_TIBBICIHAZ: ["SATIS", "IADE", "TEVKIFAT", "ISTISNA", "IHRACKAYITLI"],
  KAGIT: ["SATIS", "IADE", "TEVKIFAT", "ISTISNA", "IHRACKAYITLI"],
};

/** KDV istisna kodları (TaxExemptionReasonCode): tam (3xx), kısmi (2xx), ihraç kayıtlı (7xx), diğer */
export const EXEMPTIONS: [string, string][] = [
  ["351", "351 · İstisna olmayan diğer (%0)"],
  ["301", "301 · 11/1-a Mal ihracatı"],
  ["302", "302 · 11/1-a Hizmet ihracatı"],
  ["338", "338 · İmalatçıların mal ihracatı"],
  ["334", "334 · 13/l Yabancılara verilen sağlık hizmetleri"],
  ["350", "350 · Diğer istisnalar"],
  ["303", "303 · Roaming hizmetleri"],
  ["304", "304 · 13/a Deniz, hava ve demiryolu taşıma araçları"],
  ["305", "305 · 13/b Liman ve hava meydanı hizmetleri"],
  ["306", "306 · 13/c Petrol aramaları"],
  ["307", "307 · 13/c Maden arama"],
  ["308", "308 · 13/d Yatırım teşvik belgeli teslimler"],
  ["309", "309 · 13/e Liman ve hava meydanı inşası"],
  ["310", "310 · 13/f Ulusal güvenlik"],
  ["311", "311 · 14/1 Uluslararası taşımacılık"],
  ["312", "312 · 15/a Diplomatik organ ve misyonlar"],
  ["313", "313 · 15/b Uluslararası kuruluşlar"],
  ["314", "314 · 19/2 Usulüne göre yürürlüğe girmiş uluslararası anlaşmalar"],
  ["315", "315 · 14/3 İhraç konusu eşya taşıyan araçlara motorin"],
  ["316", "316 · 11/1-a Serbest bölgedeki müşteri için fason hizmet"],
  ["317", "317 · 17/4-s Engellilerin eğitimi, meslek ve sosyal yaşamı için araç-gereç"],
  ["318", "318 · Geçici 29 Yap-işlet-devret projeleri"],
  ["319", "319 · 13/g Başbakanlık merkez teşkilatına araç teslimleri"],
  ["320", "320 · Geçici 16 İSMEP kapsamında İstanbul İl Özel İdaresine teslimler"],
  ["321", "321 · Geçici 26 BM, NATO ve benzeri kuruluşlara teslimler"],
  ["322", "322 · 11/1-c Bavul ticareti"],
  ["323", "323 · 13/ğ Ürün senetleri"],
  ["324", "324 · 13/h Türkiye Kızılay Derneğine teslimler"],
  ["325", "325 · 13/ı Yem teslimleri"],
  ["326", "326 · 13/ı Gübre teslimleri"],
  ["327", "327 · 13/ı Gübre ve yem hammaddesi"],
  ["328", "328 · 13/i Konut veya işyeri teslimleri"],
  ["329", "329 · Eğitimde FATİH projesi"],
  ["330", "330 · 13/j Organize sanayi bölgeleri"],
  ["331", "331 · 13/m Ar-Ge ve tasarım makine-teçhizatı"],
  ["332", "332 · Geçici 39 İmalat sanayii makine-teçhizatı"],
  ["333", "333 · 13/k Bağışlanacak tesislerin inşası"],
  ["335", "335 · 13/n Basılı kitap ve süreli yayınlar"],
  ["336", "336 · UEFA müsabakaları"],
  ["337", "337 · TürkAkım gaz taşıma"],
  ["339", "339 · Teşvik belgeli inşaat işleri"],
  ["340", "340 · Elektrikli araç şarj mühendislik hizmetleri"],
  ["341", "341 · Afet bölgesi konut teslimleri"],
  ["342", "342 · Kamuya bağışlanacak tesisler"],
  ["343", "343 · Kamuya bağış"],
  ["344", "344 · 13/o Savunma araçları"],
  ["201", "201 · 17/1 Kültür ve eğitim amacı taşıyan işlemler (kısmi)"],
  ["202", "202 · 17/2-a Sağlık, çevre ve sosyal yardım (kısmi)"],
  ["250", "250 · Diğer kısmi istisnalar"],
  ["701", "701 · 3065 s. KDV 11/1-c ihraç kayıtlı teslim"],
  ["702", "702 · DİİB ve geçici kabul rejimi kapsamında ihraç kayıtlı"],
  ["703", "703 · 4760 s. ÖTV 8/2 ihraç kayıtlı"],
  ["704", "704 · KDV 11/1-c ve ÖTV 8/2 ihraç kayıtlı"],
  ["555", "555 · KDV oran kontrolüne tabi olmayan satışlar"],
];
export const EXEMPTION_TEXT: Record<string, string> = Object.fromEntries(EXEMPTIONS.map(([k, v]) => [k, v.replace(/^\d{3} · /, "")]));

/** Kısmi tevkifat kodları (WithholdingTaxTotal / TaxTypeCode) ve oranları (KDV'nin %'si) */
export const WITHHOLDINGS: [string, string, number][] = [
  ["601", "Yapım işleri ile mühendislik-mimarlık ve etüt-proje", 40],
  ["602", "Etüt, plan-proje, danışmanlık, denetim", 90],
  ["603", "Makine, teçhizat, demirbaş ve taşıtlara ait tadil, bakım ve onarım", 70],
  ["604", "Yemek servis hizmeti", 50],
  ["605", "Organizasyon hizmeti", 50],
  ["606", "İşgücü temin hizmetleri", 90],
  ["607", "Özel güvenlik hizmeti", 90],
  ["608", "Yapı denetim hizmetleri", 90],
  ["609", "Fason tekstil ve konfeksiyon işleri", 70],
  ["610", "Turistik mağazalara müşteri bulma / götürme", 90],
  ["611", "Spor kulüplerinin yayın, reklam ve isim hakkı", 90],
  ["612", "Temizlik hizmeti", 90],
  ["613", "Çevre ve bahçe bakım hizmetleri", 90],
  ["614", "Servis taşımacılığı", 50],
  ["615", "Her türlü baskı ve basım hizmetleri", 70],
  ["616", "Diğer hizmetler (5018 s. kanun kapsamındaki idarelere)", 50],
  ["617", "Hurda metalden elde edilen külçe teslimleri", 70],
  ["618", "Bakır, çinko, demir-çelik, alüminyum ve kurşun külçe", 70],
  ["619", "Bakır, çinko, alüminyum ve kurşun ürünleri", 70],
  ["620", "İstisnadan vazgeçenlerin hurda ve atık teslimi", 70],
  ["621", "Metal, plastik, lastik, kauçuk, kâğıt, cam hurda ve atıklardan hammadde", 90],
  ["622", "Pamuk, tiftik, yün, yapağı, ham post ve deri", 90],
  ["623", "Ağaç ve orman ürünleri", 50],
  ["624", "Yük taşımacılığı hizmeti", 20],
  ["625", "Ticari reklam hizmetleri", 30],
  ["626", "Diğer teslimler", 20],
  ["627", "Demir-çelik ürünleri", 50],
];

export const INCOTERMS: [string, string][] = [
  ["EXW", "EXW · İşyerinde teslim"], ["FCA", "FCA · Taşıyıcıya teslim"], ["CPT", "CPT · Taşıma ödenmiş"], ["CIP", "CIP · Taşıma ve sigorta ödenmiş"],
  ["DAP", "DAP · Belirlenen yerde teslim"], ["DPU", "DPU · Boşaltılmış olarak teslim"], ["DDP", "DDP · Gümrük vergileri ödenmiş"],
  ["FAS", "FAS · Gemi doğrultusunda"], ["FOB", "FOB · Gemide teslim"], ["CFR", "CFR · Masraflar ve navlun"], ["CIF", "CIF · Masraflar, sigorta ve navlun"],
];
export const TRANSPORT_MODES: [number, string][] = [[1, "Deniz"], [2, "Demiryolu"], [3, "Karayolu"], [4, "Havayolu"], [5, "Posta / kargo"], [6, "Çok araçlı"], [7, "Sabit taşıma tesisleri"], [8, "İç su"]];
export const PACKAGE_KINDS: [string, string][] = [["BX", "Kutu"], ["CT", "Karton"], ["PK", "Paket"], ["PA", "Paket (küçük)"], ["EN", "Zarf"], ["BG", "Torba"], ["CS", "Sandık"], ["PX", "Palet"]];
export const PAY_METHODS: [string, string][] = [["KREDIKARTI/BANKAKARTI", "Kredi / banka kartı"], ["EFT/HAVALE", "EFT / havale"], ["KAPIDAODEME", "Kapıda ödeme"], ["ODEMEARACISI", "Ödeme aracısı"], ["DIGER", "Diğer"]];

/** Gümrük ve Ticaret Bakanlığı (ihracat faturası alıcısı) */
export const CUSTOMS_PARTY = { vkn: "1460415308", name: "Gümrük ve Ticaret Bakanlığı Gümrükler Genel Müdürlüğü- Bilgi İşlem Dairesi Başkanlığı", office: "Ulus", city: "Ankara", alias: "urn:mail:ihracatpk@gtb.gov.tr" };

export const EINV_SEND_STATUS: Record<string, [string, "gray" | "blue" | "amber" | "green" | "red"]> = {
  none: ["—", "gray"], ready: ["Gönderime hazır", "amber"], sending: ["Gönderiliyor", "blue"], draft_sent: ["eLogo taslaklarında (onay bekliyor)", "amber"],
  sent: ["Gönderildi", "blue"], accepted: ["Kabul edildi", "green"], rejected: ["Reddedildi", "red"], imported: ["e-Faturadan alındı", "blue"], error: ["Hata", "red"], cancelled: ["İptal edildi", "red"],
};

/** eLogo / GİB durum kodları */
export const ELOGO_CODES: Record<number, string> = {
  [-3]: "Geçici hata, sonra yeniden denenecek", 0: "Belge henüz işleme alınmadı", 10: "Entegratörde kuyrukta", 20: "Entegratörde işlendi", 30: "Entegratörde imzalandı", 40: "Entegratörde zarflandı",
  50: "GİB'e gönderildi", 1000: "GİB: zarf kuyruğa eklendi", 1100: "GİB: zarf işleniyor", 1150: "GİB: schematron kontrolü hatalı", 1200: "GİB: zarf başarıyla işlendi",
  1210: "GİB: belge alıcı adresine gönderilemedi", 1220: "GİB: alıcıdan sistem yanıtı gelmedi", 1230: "GİB: alıcıdan sistem yanıtı başarısız", 1300: "GİB: başarıyla tamamlandı",
};
