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
  if (/approval_pending/.test(m)) return "Sipariş onay akışında; akıştaki onaylar tamamlanınca onaylanır (Onaylar sayfası).";
  if (/po_not_open/.test(m)) return "Sipariş bu işlem için uygun durumda değil.";
  if (/party_required/.test(m)) return "Tedarikçi seçin.";
  if (/lines_required/.test(m)) return "En az bir kalem girin.";
  if (/not_allowed/.test(m)) return "Bu işlem için yetkiniz yok.";
  if (/mail_account_not_yours/.test(m)) return "Gönderen e-posta olarak yalnız kendi bağladığınız Gmail hesabını seçebilirsiniz.";
  if (/bad_email/.test(m)) return "Geçerli bir e-posta adresi yazın.";
  if (/sup_portal_users_email|duplicate key/.test(m)) return "Bu e-posta bu tedarikçide zaten tanımlı.";
  if (/pur_order_send_mark|sup_user_save|pur_settings_send_save|sup_portal_users|send_state/.test(m)) return "Supabase'de 20270119000000_supplier_orders.sql çalıştırılmalı.";
  if (/lab_order|pur_order|pur_settings|pur_suggestions|schema cache/.test(m)) return "Supabase'de 20261212000000_orders.sql çalıştırılmalı.";
  return m;
}

export type SupFields = { status: string; send_state?: string | null; sent_via?: string[] | null; send_error?: string | null; sup_seen_at?: string | null; sup_ack_at?: string | null; sup_promised_date?: string | null; sup_shipped_at?: string | null; sup_declined_at?: string | null };

/** Tedarikçi tarafındaki durum (liste ve detay için kısa etiket) */
export function supStatus(o: SupFields): [string, string] | null {
  if (!["approved", "sent", "partial"].includes(o.status)) return null;
  if (o.sup_declined_at) return ["Tedarikçi karşılayamıyor", "bg-bad-bg text-bad"];
  if (o.sup_shipped_at) return ["Sevk edildi", "bg-ok-bg text-ok"];
  if (o.sup_ack_at) return [o.sup_promised_date ? `Onayladı · termin ${o.sup_promised_date.split("-").reverse().join(".")}` : "Tedarikçi onayladı", "bg-ok-bg text-ok"];
  if (o.sup_seen_at) return ["Tedarikçi gördü", "bg-[#E7F1FB] text-brand-700"];
  if (o.send_state === "queued") return ["Gönderiliyor…", "bg-[#EEF2F6] text-muted"];
  if (o.send_state === "failed") return ["Gönderilemedi", "bg-warn-bg text-warn"];
  if (o.send_state === "sent" || o.send_state === "manual") return [`İletildi${o.sent_via?.length ? ` (${o.sent_via.map((v) => (v === "email" ? "e-posta" : v === "whatsapp" ? "WhatsApp" : "elle")).join(", ")})` : ""}`, "bg-[#E7F1FB] text-brand-700"];
  return ["Henüz iletilmedi", "bg-warn-bg text-warn"];
}
