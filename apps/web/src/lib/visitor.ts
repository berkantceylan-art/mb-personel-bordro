// Ziyaretçi: ortak etiketler ve hata metinleri
export const VIS_STATUS: Record<string, [string, string]> = {
  expected: ["Bekleniyor", "bg-[#EAF2FB] text-brand-700"], in: ["İçeride", "bg-ok-bg text-ok"], out: ["Çıktı", "bg-[#EEF2F6] text-[#33414F]"], cancelled: ["İptal", "bg-bad-bg text-bad"],
};
export const visNo = (v: { year: number; no: number }) => `ZY-${v.year}-${String(v.no).padStart(4, "0")}`;
export function visError(m: string): string {
  if (/vis_|schema cache/.test(m) && /function|relation|does not exist|schema cache/.test(m)) return "Supabase'de 20270110000000_visitors.sql çalıştırılmalı.";
  if (/not_allowed/.test(m)) return "Bu işlem için güvenlik görevlisi yetkisi gerekir.";
  if (/visit_not_found/.test(m)) return "Ziyaret bulunamadı (QR / kart no / ZY no).";
  if (/already_out/.test(m)) return "Bu ziyaretçi zaten çıkış yapmış.";
  if (/visit_cancelled/.test(m)) return "Ziyaret iptal edilmiş.";
  if (/name_required/.test(m)) return "Ziyaretçi adını yazın.";
  if (/bad_status/.test(m)) return "Ziyaret bu işlem için uygun durumda değil.";
  return m;
}
