// Malzeme isteği: durum etiketleri, numara ve hata metinleri (sunucu ve tarayıcıda ortak)
export const MR_STATUS: Record<string, [string, string]> = {
  pending: ["Depoda bekliyor", "bg-warn-bg text-warn"],
  purchase: ["Satın alma onayı bekliyor", "bg-[#F3E8FF] text-[#6D28D9]"],
  approved: ["Satın alınıyor", "bg-[#EAF2FB] text-brand-700"],
  ready: ["Teslime hazır", "bg-[#DEF5FC] text-[#0E7490]"],
  delivered: ["Teslim edildi · imza bekliyor", "bg-[#FEF3C7] text-[#92400E]"],
  completed: ["Tamamlandı", "bg-ok-bg text-ok"],
  rejected: ["Reddedildi", "bg-bad-bg text-bad"],
  cancelled: ["İptal", "bg-[#EEF2F6] text-[#33414F]"],
};
export const MR_EVENT: Record<string, string> = {
  create: "İstek oluşturuldu",
  cancel: "Personel iptal etti",
  prepare: "Depo teslime hazırladı",
  to_purchase: "Depo satın almaya gönderdi",
  reject: "Depo reddetti",
  purchase_approve: "Satın alma onayladı",
  purchase_reject: "Satın alma reddetti",
  bought: "Satın alındı, depoya geldi",
  deliver: "Depo teslim etti ve imzaladı",
  deliver_signed: "Teslim edildi; depo ve personel imzaladı",
  employee_sign: "Personel teslim aldığını imzaladı",
  listed: "Alım listesine eklendi",
};
export const KIND_PREFIX: Record<string, string> = { material: "MT", asset: "DT", supply: "SP" };
export const KIND_LABEL: Record<string, string> = { material: "Malzeme", asset: "Demirbaş", supply: "Dış sipariş" };
export const mrNo = (r: { year: number; no: number; kind?: string | null }) => `${KIND_PREFIX[r.kind ?? "material"] ?? "MT"}-${r.year}-${String(r.no).padStart(4, "0")}`;
export const buyNo = (b: { year: number; no: number }) => `AL-${b.year}-${String(b.no).padStart(4, "0")}`;
export const qtyFmt = (n: number | string) => Number(n).toLocaleString("tr-TR", { maximumFractionDigits: 3 });

export function mrError(m: string): string {
  if (/stk_req_create2|stk_buy|kind/.test(m) && /function|column|schema cache|does not exist/.test(m)) return "Supabase'de 20270105000000_request_kinds.sql çalıştırılmalı.";
  if (/asset_not_available/.test(m)) return "Seçilen demirbaş boşta değil (zimmetli / bakımda).";
  if (/asset_not_found/.test(m)) return "Demirbaş bulunamadı.";
  if (/bad_courier/.test(m)) return "Seçilen kurye bu şirkette değil.";
  if (/stk_req|stk_requests|schema cache/.test(m)) return "Supabase'de 20270102000000_material_requests.sql çalıştırılmalı.";
  if (/not_employee/.test(m)) return "Hesabınız bir personel kaydına bağlı değil.";
  if (/not_allowed/.test(m)) return "Bu işlem için yetkiniz yok.";
  if (/bad_status/.test(m)) return "İstek bu işlem için uygun durumda değil (sayfayı yenileyin).";
  if (/note_required/.test(m)) return "Ret gerekçesi yazın.";
  if (/signature_required/.test(m)) return "İmza atılmadı.";
  if (/no_lines|line_name|line_qty/.test(m)) return "En az bir kalem ve geçerli miktar girin.";
  if (/no_qty/.test(m)) return "Teslim edilen miktar girin.";
  if (/qty_too_high/.test(m)) return "Teslim miktarı istenenin çok üstünde.";
  if (/lot_blocked/.test(m)) return "Bu malzemenin lotu karantinada / geri çağrılmış.";
  return m;
}
