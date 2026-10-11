/** Klinik siparişi ve satın alma siparişi: etiketler */
export const ORDER_SOURCE: Record<string, string> = { phone: "Telefon", whatsapp: "WhatsApp", email: "E-posta", scanner: "Ağız içi tarayıcı", courier: "Kurye getirdi", portal: "Portal", visit: "Yüz yüze", other: "Diğer" };
export const ORDER_STATUS: Record<string, [string, string]> = {
  new: ["Yeni", "bg-[#FFF4E0] text-[#8A5A00]"], confirmed: ["Onaylandı", "bg-[#EAF2FB] text-brand-700"], job: ["İşe dönüştü", "bg-ok-bg text-ok"], cancelled: ["İptal", "bg-[#EEF2F6] text-muted"],
};
export const orderNo = (y: number, n: number) => `SİP-${y}-${String(n).padStart(4, "0")}`;

export const PO_STATUS: Record<string, [string, string]> = {
  draft: ["Taslak", "bg-[#EEF2F6] text-muted"], pending: ["Onay bekliyor", "bg-[#FFF4E0] text-[#8A5A00]"], approved: ["Onaylandı", "bg-[#EAF2FB] text-brand-700"],
  sent: ["Tedarikçiye gönderildi", "bg-[#EDE9FE] text-[#6D28D9]"], partial: ["Kısmen teslim alındı", "bg-[#E0F2FE] text-[#0369A1]"], received: ["Teslim alındı", "bg-ok-bg text-ok"],
  invoiced: ["Faturalandı", "bg-ok-bg text-ok"], cancelled: ["İptal", "bg-[#EEF2F6] text-muted"],
};
export const poNo = (y: number, n: number) => `SA-${y}-${String(n).padStart(4, "0")}`;

export function orderError(m: string): string {
  if (/order_closed/.test(m)) return "Sipariş işe dönüşmüş ya da iptal edilmiş.";
  if (/customer_required/.test(m)) return "Hekim / klinik seçin.";
  if (/po_locked/.test(m)) return "Yalnız taslak sipariş düzenlenebilir.";
  if (/po_not_open/.test(m)) return "Sipariş bu işlem için uygun durumda değil.";
  if (/party_required/.test(m)) return "Tedarikçi seçin.";
  if (/lines_required/.test(m)) return "En az bir kalem girin.";
  if (/not_allowed/.test(m)) return "Bu işlem için yetkiniz yok.";
  if (/lab_order|pur_order|pur_settings|pur_suggestions|schema cache/.test(m)) return "Supabase'de 20261212000000_orders.sql çalıştırılmalı.";
  return m;
}
