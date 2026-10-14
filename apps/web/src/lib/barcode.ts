// Barkod işlemleri: hata metinleri ve ortak sabitler (sunucu ve tarayıcıda ortak)
export function bcErrorText(m: string): string {
  if (/stk_rcv|stk_receipts|ast_count|stk_issue|stk_item_lookup/.test(m) && /function|relation|does not exist|schema cache/.test(m)) return "Supabase'de 20270107000000_barcode.sql çalıştırılmalı.";
  if (/gtin_not_found:(\d+)/.test(m)) return `Bu karekoddaki ürün (GTIN ${m.match(/gtin_not_found:(\d+)/)?.[1] ?? ""}) hiçbir stok kartında yok. Kartın barkoduna ya da ÜTS ürün numarasına bu numarayı girin.`;
  if (/serial_dup:(.*)/.test(m)) return `Bu seri numarası zaten okutuldu: ${m.match(/serial_dup:([^"\n]*)/)?.[1] ?? ""}`;
  if (/item_not_found/.test(m)) return "Bu barkod / kodla kayıtlı ürün yok. Stok kartına barkodu ekleyin ya da serbest kalem girin.";
  if (/asset_not_found/.test(m)) return "Bu kodla demirbaş bulunamadı.";
  if (/not_allowed/.test(m)) return "Bu işlem için yetkiniz yok.";
  if (/bad_status/.test(m)) return "Kayıt kapanmış ya da işlem için uygun değil (sayfayı yenileyin).";
  if (/po_not_open/.test(m)) return "Sipariş teslim almaya açık değil.";
  if (/stock_choice_required/.test(m)) return "Stoğa eklensin mi? sorusunu yanıtlayın.";
  if (/signature_required/.test(m)) return "Teslim alan imzası gerekli.";
  if (/employee_signature_required/.test(m)) return "Personel imzası gerekli.";
  if (/no_qty|no_lines/.test(m)) return "Okutulan / girilen ürün yok.";
  if (/lot_required:(.*)/.test(m)) return `Lot numarası gerekli: ${m.match(/lot_required:([^"\n]*)/)?.[1] ?? ""}`;
  if (/expiry_required:(.*)/.test(m)) return `Son kullanma tarihi gerekli: ${m.match(/expiry_required:([^"\n]*)/)?.[1] ?? ""}`;
  if (/damaged_gt_qty/.test(m)) return "Hasarlı adet gelen adetten fazla olamaz.";
  if (/invoice_not_found/.test(m)) return "Fatura bulunamadı.";
  if (/lot_blocked/.test(m)) return "Bu malzemenin lotu karantinada / geri çağrılmış.";
  return m;
}

export const RCV_STATUS: Record<string, [string, string]> = {
  open: ["Okutuluyor", "bg-[#EAF2FB] text-brand-700"],
  confirmed: ["Onaylandı", "bg-ok-bg text-ok"],
  cancelled: ["İptal", "bg-[#EEF2F6] text-[#33414F]"],
};
export const rcvNo = (r: { year: number; no: number }) => `MK-${r.year}-${String(r.no).padStart(4, "0")}`;
export const dsNo = (r: { year: number; no: number }) => `DS-${r.year}-${String(r.no).padStart(4, "0")}`;
export const ASSET_CATS: Record<string, string> = { BILGISAYAR: "Bilgisayar", TELEFON: "Telefon", EL_ALETI: "El aleti", MAKINE: "Makine / cihaz", ANAHTAR_KART: "Anahtar / kart", ARAC: "Araç", KIYAFET_KKD: "Kıyafet / KKD", MOBILYA: "Mobilya", DIGER: "Diğer" };
export const COND: Record<string, [string, string]> = { ok: ["Sağlam", "text-ok"], damaged: ["Hasarlı", "text-warn"], broken: ["Arızalı", "text-bad"] };
