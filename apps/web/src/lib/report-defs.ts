/** Rapor tasarlayıcı: veri kümeleri, kırılımlar ve ölçüler (yalnız etiketler; sorgular sunucuda) */
export type DsKey = "jobs" | "items" | "payments" | "expenses" | "invoices" | "complaints" | "remakes" | "stock";
export type DsDef = { label: string; modules: string[]; dates: [string, string][]; dims: Record<string, string>; metrics: Record<string, string>; money: boolean };

export const DATASETS: Record<DsKey, DsDef> = {
  jobs: { label: "İşler", modules: ["lab", "sales", "production"], dates: [["in_date", "Giriş tarihi"], ["delivered_at", "Teslim tarihi"], ["due_date", "Teslim günü (plan)"]], dims: { month: "Ay", week: "Hafta", customer: "Hekim / klinik", doctor: "Doktor", status: "Durum", stage: "Aşama" }, metrics: { count: "İş sayısı", total: "Tutar" }, money: true },
  items: { label: "İş kalemleri (ürünler)", modules: ["lab", "sales", "production"], dates: [["in_date", "İş giriş tarihi"], ["delivered_at", "Teslim tarihi"]], dims: { month: "Ay", product: "Ürün", customer: "Hekim / klinik", kind: "Kalem türü" }, metrics: { qty: "Adet / ünit", amount: "Tutar", count: "Satır sayısı" }, money: true },
  payments: { label: "Hekim tahsilatları", modules: ["finance", "sales", "lab"], dates: [["paid_on", "Tahsilat tarihi"]], dims: { month: "Ay", customer: "Hekim / klinik", method: "Yöntem", book: "Defter" }, metrics: { amount: "Tutar", count: "Adet" }, money: true },
  expenses: { label: "Masraflar (işlenen)", modules: ["expenses", "finance"], dates: [["expense_date", "Masraf tarihi"]], dims: { month: "Ay", category: "Masraf türü", employee: "Personel", vendor: "Satıcı" }, metrics: { amount: "Tutar", count: "Adet" }, money: true },
  invoices: { label: "Faturalar (işlenen)", modules: ["sales", "purchases", "finance"], dates: [["invoice_date", "Fatura tarihi"]], dims: { month: "Ay", party: "Cari", direction: "Yön (satış / alış)" }, metrics: { total: "Genel toplam", subtotal: "Matrah", vat: "KDV", count: "Adet" }, money: true },
  complaints: { label: "Şikâyetler", modules: ["lab", "production", "sales"], dates: [["received_at", "Geliş tarihi"]], dims: { month: "Ay", category: "Kategori", customer: "Hekim / klinik", severity: "Ciddiyet", source: "Kaynak", status: "Durum" }, metrics: { count: "Adet", cost: "Maliyet" }, money: false },
  remakes: { label: "Yeniden yapımlar", modules: ["production", "lab"], dates: [["created_at", "Kayıt tarihi"]], dims: { month: "Ay", reason: "Neden", station: "İstasyon", employee: "Teknisyen" }, metrics: { count: "Adet" }, money: false },
  stock: { label: "Stok hareketleri", modules: ["stock", "purchases"], dates: [["move_date", "Hareket tarihi"]], dims: { month: "Ay", item: "Malzeme", kind: "Hareket türü" }, metrics: { qty: "Miktar", value: "Tutar (maliyet)", count: "Adet" }, money: false },
};

export const PRESETS: Record<string, string> = { this_month: "Bu ay", last_month: "Geçen ay", last_3: "Son 3 ay", last_6: "Son 6 ay", last_12: "Son 12 ay", this_year: "Bu yıl", last_year: "Geçen yıl", custom: "Tarih aralığı" };

export type ReportConfig = { ds: DsKey; date: string; preset: string; from?: string; to?: string; dim: string; dim2?: string; metric: string; currency?: string; chart: "bar" | "line" | "table"; top?: number };

/** Hazır aralık → [başlangıç, bitiş] (İstanbul günü) */
export function presetRange(p: string, from?: string, to?: string): [string, string] {
  const now = new Date(Date.now() + 3 * 3600 * 1000);
  const y = now.getUTCFullYear(), m = now.getUTCMonth();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const first = (yy: number, mm: number) => iso(new Date(Date.UTC(yy, mm, 1)));
  const last = (yy: number, mm: number) => iso(new Date(Date.UTC(yy, mm + 1, 0)));
  switch (p) {
    case "last_month": return [first(y, m - 1), last(y, m - 1)];
    case "last_3": return [first(y, m - 2), iso(now)];
    case "last_6": return [first(y, m - 5), iso(now)];
    case "last_12": return [first(y, m - 11), iso(now)];
    case "this_year": return [`${y}-01-01`, iso(now)];
    case "last_year": return [`${y - 1}-01-01`, `${y - 1}-12-31`];
    case "custom": return [/^\d{4}-\d{2}-\d{2}$/.test(from ?? "") ? from! : first(y, m), /^\d{4}-\d{2}-\d{2}$/.test(to ?? "") ? to! : iso(now)];
    default: return [first(y, m), iso(now)];
  }
}
