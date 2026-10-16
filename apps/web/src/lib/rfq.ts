/** Teklif isteği (RFQ) yardımcıları — istemci ve sunucu ortak */
export const rfqNo = (r: { year: number; no: number }) => `TK-${r.year}-${String(r.no).padStart(4, "0")}`;
export const RFQ_STATUS: Record<string, [string, string]> = { open: ["Teklif toplanıyor", "bg-warn-bg text-warn"], awarded: ["Siparişe döndü", "bg-ok-bg text-ok"], cancelled: ["İptal", "bg-[#EEF2F6] text-muted"] };
export const SUP_STATUS: Record<string, [string, string]> = { invited: ["Gönderilmedi / bekleniyor", "bg-[#EEF2F6] text-muted"], viewed: ["Gördü", "bg-[#EEF4FB] text-brand-700"], quoted: ["Teklif verdi", "bg-ok-bg text-ok"], declined: ["Teklif vermedi", "bg-bad-bg text-bad"] };
export function rfqError(m: string): string {
  if (/pur_rfq|sup_rfq|schema cache|does not exist/.test(m)) return "Supabase'de mbdental-satinalma-2.sql çalıştırılmalı.";
  if (/rfq_closed/.test(m)) return "Teklif isteği kapanmış.";
  if (/no_quote/.test(m)) return "Bu tedarikçinin teklifi yok.";
  if (/lines_required/.test(m)) return "En az bir kalem girin.";
  if (/party_required/.test(m)) return "En az bir tedarikçi seçin.";
  if (/not_allowed/.test(m)) return "Bu işlem için yetkiniz yok.";
  return m;
}
