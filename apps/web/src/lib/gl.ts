/** Genel muhasebe: ortak etiketler ve hata metinleri (sunucu ve tarayıcı) */

export const VOUCHER_KIND: Record<string, string> = { mahsup: "Mahsup", tahsil: "Tahsil", tediye: "Tediye", acilis: "Açılış", kapanis: "Kapanış" };
export const VOUCHER_STATUS: Record<string, [string, "green" | "amber" | "gray" | "red" | "blue"]> = {
  posted: ["Kayıtlı", "green"], pending: ["Eşleştirme bekliyor", "amber"], excluded: ["Muhasebe dışı", "gray"], cancelled: ["İptal", "red"],
};
export const VOUCHER_SOURCE: Record<string, string> = { auto: "Otomatik", manual: "Elle", opening: "Açılış", closing: "Kapanış", fx: "Kur değerleme", payroll: "Bordro tahakkuk", reversal: "Ters kayıt", vat: "KDV / damga", tax: "Vergi tahakkuku", period: "Dönem sonu" };
export const DOC_TYPE: Record<string, string> = { invoice: "Fatura", check: "Çek", note: "Senet", receipt: "Makbuz / dekont", voucher: "Fiş", other: "Diğer" };
export const ACC_KIND: Record<string, string> = { asset: "Aktif", liability: "Pasif", equity: "Özkaynak", income: "Gelir", expense: "Gider", cost: "Maliyet", memo: "Nazım" };

export type GlAccount = { id: string; code: string; name: string; parent_id: string | null; kind: string; normal_side: "D" | "C"; postable: boolean; currency: string | null; link_type: string | null; link_id: string | null; is_system: boolean; is_active: boolean; note: string | null };

export const level = (code: string) => code.split(".").length;

export function glError(m: string): string {
  if (/gl_|ledger/.test(m) && /function|relation|does not exist|schema cache|check constraint "module_permissions/.test(m)) return "Supabase'de 20270206000000_gl_core.sql çalıştırılmalı.";
  if (/not_allowed/.test(m)) return "Bu işlem için muhasebe yetkiniz yok (Yönetim › Kullanıcılar › Genel muhasebe).";
  if (/gl_locked/.test(m)) return "Bu tarih kilitli dönemde: fiş eklenemez / değiştirilemez.";
  if (/gl_unbalanced:([0-9]+) \/ ([0-9]+)/.test(m)) { const x = m.match(/gl_unbalanced:([0-9]+) \/ ([0-9]+)/)!; return `Borç (${(Number(x[1]) / 100).toLocaleString("tr-TR")}) ile alacak (${(Number(x[2]) / 100).toLocaleString("tr-TR")}) eşit değil.`; }
  if (/gl_account_missing:(.*)/.test(m)) return `Hesap planında yok: ${m.match(/gl_account_missing:([^"\n]*)/)?.[1] ?? ""}`;
  if (/gl_not_postable:(.*)/.test(m)) return `${m.match(/gl_not_postable:([^"\n]*)/)?.[1] ?? ""} hesabının alt hesapları var: kayıt en alt hesaba yapılır.`;
  if (/gl_parent_missing:(.*)/.test(m)) return `Önce üst hesabı açın: ${m.match(/gl_parent_missing:([^"\n]*)/)?.[1] ?? ""}`;
  if (/gl_bad_code/.test(m)) return "Hesap kodu 3 haneli ana hesap ve noktayla ayrılmış alt kırılımlar olmalı (ör. 770.01.003).";
  if (/gl_name_required/.test(m)) return "Hesap adı yazın.";
  if (/gl_code_used/.test(m)) return "Kayıt görmüş hesabın kodu değiştirilemez.";
  if (/gl_account_used/.test(m)) return "Kayıt görmüş hesap silinemez (pasife alın).";
  if (/gl_account_has_children/.test(m)) return "Alt hesapları olan hesap silinemez.";
  if (/gl_min_lines/.test(m)) return "Fişte en az iki satır olmalı.";
  if (/gl_auto_voucher/.test(m)) return "Otomatik fiş ERP kaydından gelir: kaynağını düzeltin ya da iptal edin.";
  if (/gl_date_required/.test(m)) return "Fiş tarihi girin.";
  if (/gl_disabled/.test(m)) return "Önce genel muhasebeyi açın (ayarlar).";
  if (/gl_opening_exists/.test(m)) return "Başlangıç tarihinde zaten bir açılış fişi var.";
  if (/duplicate key.*gl_accounts/.test(m)) return "Bu hesap kodu zaten var.";
  if (/gl_no_payroll/.test(m)) return "Bu dönemin bordrosu hesaplanmamış.";
  if (/gl_pending_before_lock/.test(m)) return "Kilitlenecek dönemde eşleştirme bekleyen kayıt var: önce onları tamamlayın.";
  if (/bad_period/.test(m)) return "Dönem YYYY-AA biçiminde olmalı.";
  if (/gl_pending_in_year/.test(m)) return "Bu yılda eşleştirme bekleyen fiş var: kapanıştan önce tamamlayın.";
  if (/gl_vat_open/.test(m)) return "191 / 391 hesaplarında bakiye var: önce son ayların KDV mahsubunu yapın.";
  if (/(gl_cit_|gl_kkeg|gl_tax_adj|kkeg_pct)/.test(m) && /function|relation|does not exist|schema cache|column/.test(m)) return "Supabase'de 20270213000000_corporate_tax.sql çalıştırılmalı.";
  if (/(gl_stamp|gl_vat2|gl_vat_refund|gl_tax_calendar|gl_filing|inv_set_export_doc|gl_stamp_docs|gl_tax_filings)/.test(m) && /function|relation|does not exist|schema cache/.test(m)) return "Supabase'de 20270212000000_tax_center.sql çalıştırılmalı.";
  if (/refund_exceeds/.test(m)) return "İade tutarı ay sonu devreden KDV'den (190) büyük olamaz: önce KDV mahsup fişini oluşturun.";
  if (/bad_amount/.test(m)) return "Tutar sıfırdan büyük olmalı.";
  if (/bad_account/.test(m)) return "Gider hesabı 6 ya da 7 ile başlayan bir hesap olmalı (ör. 770).";
  if (/bad_date/.test(m)) return "Tarih girin.";
  if (/category_missing/.test(m)) return "Kategori eksik: Supabase'de 20270212000000_tax_center.sql çalıştırılmalı.";
  if (/not_found/.test(m)) return "Kayıt bulunamadı.";
  return m;
}

/** Kuruş → "1.250,50" (para birimi işaretsiz) */
export const amt = (v: number | string | null | undefined) => (Number(v ?? 0) === 0 ? "" : (Number(v) / 100).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

const D = /^\d{4}-\d{2}-\d{2}$/;
/** Rapor dönemi: ?bas=&bit= (varsayılan: bu yılın başı → bugün) */
export function period(sp: { bas?: string; bit?: string }): { from: string; to: string } {
  const today = new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 10);
  return { from: sp.bas && D.test(sp.bas) ? sp.bas : `${today.slice(0, 4)}-01-01`, to: sp.bit && D.test(sp.bit) ? sp.bit : today };
}
/** Bakiye: borç - alacak → "1.250,00 B" / "300,00 A" */
export const bal = (v: number) => (v === 0 ? "0,00" : `${(Math.abs(v) / 100).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${v > 0 ? "B" : "A"}`);
