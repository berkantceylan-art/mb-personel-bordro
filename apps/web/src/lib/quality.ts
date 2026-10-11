/** Kalite, anket ve CRM sabitleri */
export const Q_CATEGORY: Record<string, string> = { fit: "Uyum / oturma", shade: "Renk", fracture: "Kırık / çatlak", contact: "Kontakt", occlusion: "Kapanış", aesthetic: "Estetik / form", delay: "Gecikme", damage: "Hasarlı teslim", wrong_item: "Yanlış iş", billing: "Fatura / fiyat", other: "Diğer" };
export const Q_SOURCE: Record<string, string> = { phone: "Telefon", whatsapp: "WhatsApp", email: "E-posta", visit: "Ziyaret", portal: "Portal", survey: "Anket", internal: "İç tespit", other: "Diğer" };
export const Q_SEVERITY: Record<string, [string, string]> = { low: ["Düşük", "bg-[#EEF2F6] text-muted"], medium: ["Orta", "bg-warn-bg text-warn"], high: ["Yüksek", "bg-bad-bg text-bad"] };
export const Q_STATUS: Record<string, [string, string]> = { open: ["Açık", "bg-bad-bg text-bad"], investigating: ["İnceleniyor", "bg-warn-bg text-warn"], closed: ["Kapandı", "bg-ok-bg text-ok"] };
export const NCR_SOURCE: Record<string, string> = { complaint: "Şikâyet", internal: "İç tespit", supplier: "Tedarikçi", audit: "Denetim", remake: "Yeniden yapım" };
export const NCR_STATUS: Record<string, [string, string]> = { open: ["Açık", "bg-bad-bg text-bad"], action: ["Faaliyet sürüyor", "bg-warn-bg text-warn"], verify: ["Etkinlik kontrolü", "bg-[#EAF2FB] text-brand-700"], closed: ["Kapandı", "bg-ok-bg text-ok"] };
export const LEAD_STAGE: Record<string, [string, string]> = { new: ["Yeni", "#64748B"], contacted: ["Görüşüldü", "#2563EB"], sample: ["Numune", "#7C3AED"], offer: ["Teklif", "#D97706"], won: ["Kazanıldı", "#059669"], lost: ["Kaybedildi", "#DC2626"] };
export const LEAD_SOURCE: Record<string, string> = { website: "Web sitesi", referral: "Tavsiye", visit: "Ziyaret", fair: "Fuar", social: "Sosyal medya", phone: "Telefon", other: "Diğer" };
export const ACT_KIND: Record<string, string> = { call: "Arama", visit: "Ziyaret", whatsapp: "WhatsApp", email: "E-posta", sample: "Numune", offer: "Teklif", note: "Not", task: "Görev" };

/** İç denetim için başlangıç kontrol listesi (ISO 13485 / MDR ısmarlama cihaz temel maddeleri) */
export const AUDIT_TEMPLATE = [
  "Her iş için hekim reçetesi / sipariş formu kayıtlı",
  "Ismarlama cihaz uygunluk beyanı (MDR Ek XIII) her teslimde düzenleniyor",
  "Kullanılan malzemelerin lot / SKT bilgisi işe işleniyor",
  "Karantina / geri çağrılan lot kullanılmıyor",
  "Malzeme tedarikçilerinin CE / uygunluk belgeleri güncel",
  "Cihaz ve fırın bakım / kalibrasyon kayıtları güncel",
  "Kalite kontrol onayı olmadan iş çıkmıyor",
  "Şikâyetler kayıtlı ve 30 gün içinde kapatılıyor",
  "Düzeltici faaliyetlerin terminleri takip ediliyor",
  "Personel eğitim kayıtları güncel (üretim, hijyen, İSG)",
  "Ölçü / model dezenfeksiyonu yapılıyor ve kayıt altında",
  "Geri dönen (yeniden yapım) işlerin nedenleri analiz ediliyor",
  "Teknik dosya / ürün tanımları (malzeme, endikasyon) güncel",
  "Sorumlu kişi (PRRC) atanmış ve iletişim bilgileri güncel",
];
