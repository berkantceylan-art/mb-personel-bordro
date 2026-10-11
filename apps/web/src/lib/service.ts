// Arıza / tamir / bakım: durum etiketleri ve hata metinleri (sunucu ve tarayıcıda ortak)
export const SVC_STATUS: Record<string, [string, string]> = {
  reported: ["Onay bekliyor", "bg-warn-bg text-warn"],
  approved: ["Atandı", "bg-[#EAF2FB] text-brand-700"],
  in_progress: ["İşlemde / serviste", "bg-[#DEF5FC] text-[#0E7490]"],
  done: ["Yapıldı · ücret onayı", "bg-[#F3E8FF] text-[#6D28D9]"],
  cost_approved: ["Ödeme bekliyor", "bg-[#FEF3C7] text-[#92400E]"],
  closed: ["Kapandı", "bg-ok-bg text-ok"],
  rejected: ["Reddedildi", "bg-bad-bg text-bad"],
  cancelled: ["İptal", "bg-[#EEF2F6] text-[#33414F]"],
};
export const SVC_KIND: Record<string, string> = { repair: "Arıza / tamir", external: "Dış servis", maintenance: "Periyodik bakım" };
export const SVC_PRIORITY: Record<string, [string, string]> = {
  low: ["Düşük", "text-muted"], normal: ["Normal", "text-ink"], high: ["Yüksek", "text-warn font-semibold"], urgent: ["🔴 Acil", "text-bad font-bold"],
};
export const SVC_EVENT: Record<string, string> = {
  create: "Bildirildi", cancel: "İptal edildi", reject: "Reddedildi", approve_tech: "Teknisyene atandı", reassign: "Yeniden atandı", approve_external: "Dış servise verildi",
  start: "Teknisyen başladı", sent: "Servise gönderildi", done: "Yapıldı", closed: "Kapandı", cost_approve: "Ücret onaylandı", cost_return: "Geri gönderildi", paid: "Ödendi", scheduled: "Bakım zamanı geldi (otomatik)",
};
export const svcNo = (t: { year: number; no: number }) => `SV-${t.year}-${String(t.no).padStart(4, "0")}`;
export const tl = (k: number | null | undefined) => ((k ?? 0) / 100).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const parseTl = (v: string) => {
  const n = Math.round(Number(String(v ?? "").trim().replace(/\./g, "").replace(",", ".")) * 100);
  return Number.isFinite(n) && n >= 0 ? n : NaN;
};

export function svcError(m: string): string {
  if (/svc_|schema cache/.test(m) && /function|relation|does not exist|schema cache/.test(m)) return "Supabase'de 20270106000000_service.sql çalıştırılmalı.";
  if (/not_allowed/.test(m)) return "Bu işlem için yetkiniz yok.";
  if (/bad_status/.test(m)) return "Kayıt bu işlem için uygun durumda değil (sayfayı yenileyin).";
  if (/note_required/.test(m)) return "Açıklama / gerekçe yazın.";
  if (/title_required/.test(m)) return "Arızayı kısaca yazın.";
  if (/tech_required/.test(m)) return "Teknisyen seçin.";
  if (/vendor_required/.test(m)) return "Servis firmasını yazın.";
  if (/account_required/.test(m)) return "Ödeme hesabı seçin.";
  if (/category_missing/.test(m)) return "Finans kategorileri eksik (Bakım / onarım, İndirilecek KDV).";
  if (/too_many_photos/.test(m)) return "En fazla 12 fotoğraf eklenebilir.";
  if (/asset_not_found/.test(m)) return "Demirbaş bulunamadı.";
  return m;
}
