/**
 * İSG kuralları (6331 s. Kanun ve yönetmelikleri). Değerler bilgilendirme amaçlıdır; İSG profesyoneliyle teyit edilmelidir.
 * - İş Güvenliği Uzmanlarının Görev… Yönetmeliği md. 12, İşyeri Hekimi… Yönetmeliği md. 12: çalışan başına aylık süreler
 * - Çalışanların İSG Eğitimleri Yönetmeliği (RG 02.04.2026/33212)
 * - Risk Değerlendirmesi Yönetmeliği, Acil Durumlar Yönetmeliği, İlkyardım Yönetmeliği, İSG Kurulları Yönetmeliği
 */
import type { HazardClass } from "@mb/core";

export const KATIP_URL = "https://isgkatip.csgb.gov.tr";
export const SGK_ISVEREN_URL = "https://e.sgk.gov.tr/Uygulamalar/Isveren";

/** Çalışan başına aylık asgari süre (dakika) */
export const MINUTES: Record<"uzman" | "hekim", Record<HazardClass, number>> = {
  uzman: { AZ: 10, TEHLIKELI: 20, COK: 40 },
  hekim: { AZ: 5, TEHLIKELI: 10, COK: 15 },
};
/** Tam süreli görevlendirme gereken çalışan sayısı */
export const FULL_TIME: Record<"uzman" | "hekim", Record<HazardClass, number>> = {
  uzman: { AZ: 1000, TEHLIKELI: 500, COK: 250 },
  hekim: { AZ: 2000, TEHLIKELI: 1000, COK: 750 },
};
/** Uzman belge sınıfı: çok tehlikelide A, tehlikelide en az B, az tehlikelide en az C */
export const CERT_OK: Record<HazardClass, string[]> = { COK: ["A"], TEHLIKELI: ["A", "B"], AZ: ["A", "B", "C"] };
/** Diğer sağlık personeli: yalnız çok tehlikeli işyerlerinde 10+ çalışanda */
export function dspMinutes(hazard: HazardClass, workers: number) {
  if (hazard !== "COK" || workers < 10) return 0;
  return workers * (workers < 50 ? 10 : 15);
}
export function requiredMinutes(kind: "uzman" | "hekim" | "dsp", hazard: HazardClass, workers: number) {
  if (kind === "dsp") return dspMinutes(hazard, workers);
  return MINUTES[kind][hazard] * workers;
}
export const KIND_LABEL: Record<string, string> = { uzman: "İş güvenliği uzmanı", hekim: "İşyeri hekimi", dsp: "Diğer sağlık personeli" };
export const KATIP_STATUS: Record<string, [string, string]> = {
  "onay-bekliyor": ["Onay bekliyor", "bg-warn-bg text-warn"],
  onayli: ["Onaylı", "bg-ok-bg text-ok"],
  iptal: ["İptal", "bg-bad-bg text-bad"],
  "sona-erdi": ["Sona erdi", "bg-[#EEF2F6] text-[#33414F]"],
};
export const hm = (min: number) => `${Math.floor(min / 60)} sa${min % 60 ? ` ${min % 60} dk` : ""}`;

/* --------------------------------------------------------------- Eğitim (2026) */
export const TRAINING_RULES = {
  baseHours: { AZ: 8, TEHLIKELI: 12, COK: 16 } as Record<HazardClass, number>,
  topic4Hours: { AZ: 2, TEHLIKELI: 3, COK: 4 } as Record<HazardClass, number>,
  repeatMonths: { AZ: 36, TEHLIKELI: 24, COK: 12 } as Record<HazardClass, number>,
  repeatHours: 8,
  onboardingHours: 2,
  baseDeadlineMonths: 3,
  passScore: 60,
  maxAttempts: 3,
  absenceMonths: 6,
};
export const TRAINING_KIND: Record<string, string> = { "ise-baslama": "İşe başlama", temel: "Temel", tekrar: "Tekrar", ilave: "İlave", "bilgi-yenileme": "Bilgi yenileme", diger: "Diğer" };
/** Ek-1 konu başlıkları (özet) */
export const TOPICS: Array<{ group: number; title: string; items: string[] }> = [
  { group: 1, title: "Genel konular", items: ["Çalışma mevzuatı ile ilgili bilgiler", "Çalışanların yasal hak ve sorumlulukları", "İşyeri temizliği ve düzeni", "İş kazası ve meslek hastalığından doğan hukuki sonuçlar"] },
  { group: 2, title: "Sağlık konuları", items: ["Meslek hastalıklarının sebepleri", "Hastalıktan korunma prensipleri ve korunma tekniklerinin uygulanması", "Biyolojik ve psikososyal risk etmenleri", "İlkyardım", "Tütün ürünlerinin zararları ve pasif etkilenim"] },
  { group: 3, title: "Teknik konular", items: ["Kimyasal, fiziksel ve ergonomik risk etmenleri", "Elle kaldırma ve taşıma", "Parlama, patlama, yangın ve yangından korunma", "İş ekipmanlarının güvenli kullanımı", "Ekranlı araçlarla çalışma", "Elektrik, tehlikeleri, riskleri ve önlemleri", "İş kazalarının sebepleri ve korunma prensipleri", "Güvenlik ve sağlık işaretleri", "Kişisel koruyucu donanım kullanımı", "İş sağlığı ve güvenliği genel kuralları ve güvenlik kültürü", "Tahliye ve kurtarma"] },
  { group: 4, title: "İşyerine özgü konular", items: ["Silika ve metal tozu maruziyeti, lokal havalandırma", "Kumlama ve tesviye işlemleri", "Döküm, fırın ve sıcak işler", "Kimyasallar (akrilik monomer, asitler) ve güvenlik bilgi formları", "Kompresör ve basınçlı kaplar", "Gürültü"] },
];

/* --------------------------------------------------------------- Risk, acil durum, kurul */
export const RENEW_YEARS: Record<HazardClass, number> = { COK: 2, TEHLIKELI: 4, AZ: 6 };
export const SUPPORT_PER: Record<HazardClass, number> = { AZ: 50, TEHLIKELI: 30, COK: 20 };
export const FIRST_AID_PER: Record<HazardClass, number> = { AZ: 20, TEHLIKELI: 15, COK: 10 };
export const COMMITTEE_MONTHS: Record<HazardClass, number> = { COK: 1, TEHLIKELI: 2, AZ: 3 };
export const TEAM_LABEL: Record<string, string> = { sondurme: "Söndürme ekibi", kurtarma: "Kurtarma ekibi", koruma: "Koruma ekibi", ilkyardim: "İlkyardım ekibi" };
export const supportNeeded = (hazard: HazardClass, workers: number) => Math.max(1, Math.ceil(workers / SUPPORT_PER[hazard]));
export const firstAidNeeded = (hazard: HazardClass, workers: number) => Math.max(1, Math.ceil(workers / FIRST_AID_PER[hazard]));
/** Çalışan temsilcisi sayısı (6331 md. 20) */
export function repsNeeded(workers: number) {
  if (workers < 2) return 0;
  if (workers <= 50) return 1;
  if (workers <= 100) return 2;
  if (workers <= 500) return 3;
  if (workers <= 1000) return 4;
  if (workers <= 2000) return 5;
  return 6;
}
export const COMMITTEE_ROLE: Record<string, string> = { baskan: "Başkan (işveren / vekili)", sekreter: "Sekreter (iş güvenliği uzmanı)", uzman: "İş güvenliği uzmanı", hekim: "İşyeri hekimi", ik: "İnsan kaynakları / personel", "idari-mali": "İdari ve mali işler", "sivil-savunma": "Sivil savunma uzmanı", formen: "Formen / ustabaşı", "bas-temsilci": "Baş çalışan temsilcisi", temsilci: "Çalışan temsilcisi" };

/** 5x5 matris: olasılık × şiddet */
export function level5x5(score: number): [string, string] {
  if (score >= 25) return ["Tolerans gösterilemez", "bg-[#7A0E0E] text-white"];
  if (score >= 15) return ["Yüksek", "bg-[#D9534F] text-white"];
  if (score >= 8) return ["Önemli", "bg-[#E8A33D] text-white"];
  if (score >= 3) return ["Kabul edilebilir", "bg-[#F4D35E] text-[#3A2E00]"];
  return ["Önemsiz", "bg-[#2E9D6A] text-white"];
}
/** Fine-Kinney: olasılık × frekans × şiddet */
export function levelFK(score: number): [string, string] {
  if (score > 400) return ["Tolerans gösterilemez", "bg-[#7A0E0E] text-white"];
  if (score > 200) return ["Esaslı risk", "bg-[#D9534F] text-white"];
  if (score > 70) return ["Önemli risk", "bg-[#E8A33D] text-white"];
  if (score > 20) return ["Olası risk", "bg-[#F4D35E] text-[#3A2E00]"];
  return ["Önemsiz risk", "bg-[#2E9D6A] text-white"];
}

/** Diş protez laboratuvarı için hazır risk şablonu (5x5: olasılık, şiddet) */
export const DENTAL_TEMPLATE: Array<{ area: string; activity: string; hazard: string; risk: string; affected: string; p: number; s: number; controls: string; actions: string }> = [
  { area: "Tesviye / mikromotor", activity: "Alçı, metal ve seramik tesviyesi", hazard: "Solunabilir kristal silika ve metal tozu", risk: "Silikozis, pnömokonyoz, KOAH", affected: "Teknisyenler", p: 4, s: 5, controls: "Masa üstü vakum", actions: "Her tezgâha lokal egzoz (HEPA), yılda bir toz ölçümü, FFP3 maske zimmeti, yıllık akciğer grafisi ve SFT" },
  { area: "Kumlama", activity: "Alüminyum oksit ile kumlama", hazard: "Toz, basınçlı hava", risk: "Solunum yolu hastalıkları, göz yaralanması", affected: "Kumlama operatörü", p: 3, s: 4, controls: "Kapalı kumlama kabini", actions: "Kabin filtrelerinin periyodik değişimi, toz toplayıcı bakım kaydı, koruyucu gözlük" },
  { area: "Döküm / metal", activity: "Krom-kobalt ve nikel alaşım döküm", hazard: "Metal dumanı, berilyum içerikli alaşımlar, sıcak yüzey", risk: "Mesleki astım, alerji, yanık", affected: "Döküm teknisyeni", p: 3, s: 4, controls: "Davlumbaz", actions: "Berilyum içermeyen alaşım tercihi, davlumbaz hava hızı ölçümü, ısıya dayanıklı eldiven" },
  { area: "Porselen / fırın", activity: "Seramik fırınlama", hazard: "Yüksek sıcaklık, elektrik", risk: "Yanık, elektrik çarpması", affected: "Porselen teknisyeni", p: 2, s: 4, controls: "Topraklı priz", actions: "Fırın çevresinde yanıcı malzeme bulundurmama, yıllık elektrik tesisatı ve topraklama ölçümü" },
  { area: "Akrilik / protez", activity: "Metil metakrilat monomer kullanımı", hazard: "Uçucu organik bileşik, yanıcı sıvı", risk: "Dermatit, solunum tahrişi, yangın", affected: "Protez teknisyenleri", p: 3, s: 3, controls: "Pencere havalandırması", actions: "Güvenlik bilgi formlarının asılması, nitril eldiven, kapalı kap saklama, lokal havalandırma" },
  { area: "Kimyasallar", activity: "Asit ile temizleme / dağlama", hazard: "Hidroflorik ve diğer asitler", risk: "Kimyasal yanık, göz hasarı", affected: "İlgili teknisyen", p: 2, s: 5, controls: "—", actions: "Göz duşu ve acil duş, kalsiyum glukonat jel, asit dolabı, eğitim" },
  { area: "Kompresör odası", activity: "Basınçlı hava üretimi", hazard: "Basınçlı kap, gürültü", risk: "Patlama, işitme kaybı", affected: "Tüm çalışanlar", p: 2, s: 5, controls: "Ayrı oda", actions: "Yıllık periyodik kontrol (yetkili kişi), emniyet ventili testi, odyometri" },
  { area: "Genel", activity: "Gürültülü tezgâh çalışması", hazard: "Gürültü (mikromotor, vakum, kumlama)", risk: "Gürültüye bağlı işitme kaybı", affected: "Teknisyenler", p: 3, s: 3, controls: "—", actions: "Gürültü ölçümü, 85 dB(A) üzerinde kulak koruyucu, yıllık odyometri" },
  { area: "Genel", activity: "Uzun süre oturarak, mikroskop/lup ile çalışma", hazard: "Ergonomik zorlanma", risk: "Kas-iskelet sistemi rahatsızlıkları, göz yorgunluğu", affected: "Teknisyenler", p: 4, s: 2, controls: "—", actions: "Ayarlanabilir sandalye ve tezgâh, aydınlatma ölçümü, mola düzeni" },
  { area: "Genel", activity: "Elektrikli ekipman kullanımı", hazard: "Elektrik", risk: "Elektrik çarpması, yangın", affected: "Tüm çalışanlar", p: 2, s: 5, controls: "Kaçak akım rölesi", actions: "Yıllık elektrik iç tesisat ve topraklama ölçümü, hasarlı kablo kontrolü" },
  { area: "Genel", activity: "Yangın", hazard: "Yanıcı monomer, gaz, elektrik", risk: "Yangın, duman zehirlenmesi", affected: "Tüm çalışanlar", p: 2, s: 5, controls: "Yangın tüpleri", actions: "Tüplerin 6 ayda bir kontrolü, yıllık tatbikat, söndürme ekibi eğitimi, acil çıkış işaretleri" },
  { area: "Model / CAD-CAM", activity: "Freze ve 3D yazıcı", hazard: "Toz, reçine buharı, hareketli parça", risk: "Solunum tahrişi, sıkışma", affected: "Operatör", p: 2, s: 3, controls: "Makine kapağı", actions: "Kapak kilidi kontrolü, reçine için eldiven ve havalandırma" },
  { area: "Enfeksiyon", activity: "Klinikten gelen ölçü ve protezler", hazard: "Biyolojik etken", risk: "Enfeksiyon", affected: "Kabul / kayıt personeli", p: 2, s: 4, controls: "—", actions: "Kabul noktasında dezenfeksiyon prosedürü, eldiven, hepatit B aşı takibi" },
];
