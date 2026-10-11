/** Stok modülü: etiketler ve biçimler */

export const ITEM_KIND: Record<string, string> = { material: "Malzeme", raw: "Hammadde", consumable: "Sarf", product: "Mamul / ürün", goods: "Ticari mal", service: "Hizmet", packaging: "Ambalaj" };
export const UNITS = ["adet", "kutu", "paket", "gr", "kg", "ml", "lt", "m", "cm", "disk", "blok", "takım", "çift", "diş", "rulo", "şişe", "tüp", "saat"];
export const WH_KIND: Record<string, string> = { main: "Ana depo", production: "Üretim", quarantine: "Karantina", consignment: "Konsinye", vehicle: "Araç", other: "Diğer" };
export const MOVE_KIND: Record<string, [string, "green" | "red" | "blue" | "amber" | "gray"]> = {
  opening: ["Açılış", "blue"], purchase: ["Alış", "green"], purchase_return: ["Alış iadesi", "red"], sale: ["Satış", "red"], sale_return: ["Satış iadesi", "green"],
  transfer_out: ["Transfer çıkış", "amber"], transfer_in: ["Transfer giriş", "amber"], count_adjust: ["Sayım farkı", "gray"], consume: ["Üretimde tüketim", "red"],
  produce: ["Üretimden giriş", "green"], waste: ["Fire", "red"], adjust: ["Düzeltme", "gray"],
};
export const TRANSFER_STATUS: Record<string, [string, "gray" | "amber" | "green" | "red"]> = { draft: ["Taslak", "gray"], in_transit: ["Yolda", "amber"], received: ["Teslim alındı", "green"], cancelled: ["İptal", "red"] };
export const COUNT_STATUS: Record<string, [string, "amber" | "green" | "red"]> = { open: ["Sayım sürüyor", "amber"], closed: ["Kapandı", "green"], cancelled: ["İptal", "red"] };

/** 12.5 → "12,5" (en fazla 3 ondalık) */
export const qty = (v: number | string | null | undefined) => Number(v ?? 0).toLocaleString("tr-TR", { maximumFractionDigits: 3 });
export const parseQty = (s: string | null | undefined) => {
  let t = String(s ?? "").trim();
  if (!t) return null;
  if (t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");
  const n = Number(t);
  return Number.isFinite(n) ? Math.round(n * 1000) / 1000 : null;
};

export type Item = {
  id: string; code: string; barcode: string | null; name: string; kind: string; category_id: string | null; unit: string; brand: string | null; supplier_party_id: string | null;
  purchase_price: number | null; purchase_currency: string; sale_price: number | null; sale_currency: string; vat_rate: number; min_qty: number | null; max_qty: number | null; reorder_qty: number | null;
  track_lot: boolean; track_expiry: boolean; shelf: string | null; lab_product_id: string | null; default_warehouse_id: string | null; note: string | null; is_active: boolean;
};
export type Warehouse = { id: string; code: string | null; name: string; kind: string; address: string | null; responsible: string | null; is_default: boolean; is_active: boolean };

export function stockError(message: string): string {
  if (/not_allowed|permission|policy/i.test(message)) return "Bu işlem için stok yetkiniz yok (Yönetim > Yetkiler).";
  if (/insufficient:(.+)/.test(message)) return `Çıkış deposunda yeterli stok yok: ${message.match(/insufficient:([^"]+)/)?.[1]}`;
  if (/lot_required/.test(message)) return "Bu malzeme lot takipli: lot numarası yazın.";
  if (/expiry_required/.test(message)) return "Bu malzeme son kullanma takipli: tarihi yazın.";
  if (/item_not_found/.test(message)) return "Bu barkod / kodla kayıtlı malzeme yok.";
  if (/bad_status|closed/.test(message)) return "Belgenin durumu bu işleme uygun değil.";
  if (/stk_items_code_uidx|duplicate key.*code/i.test(message)) return "Bu kodla başka bir kart var.";
  if (/stk_items_barcode_uidx/.test(message)) return "Bu barkodla başka bir kart var.";
  if (/(stk_)\w* .*does not exist|relation "stk_|schema cache/i.test(message)) return "Stok tabloları yok: Supabase'de 20261203000000_stock.sql çalıştırılmalı.";
  return message;
}
