export const ACTION: Record<string, [string, string]> = { INSERT: ["ekledi", "#10B981"], UPDATE: ["değiştirdi", "#3B82F6"], DELETE: ["sildi", "#EF4444"] };
export const ROLE: Record<string, string> = { owner: "Şirket sahibi", hr: "İK", accountant: "Muhasebe", branch_manager: "Şube müdürü", employee: "Personel", doctor: "Hekim", clinic: "Klinik", supplier: "Tedarikçi" };
export const LINK: Record<string, (id: string) => string> = {
  inv_invoices: (id) => `/fatura/${id}`, fin_parties: (id) => `/finans/cariler/${id}`, fin_accounts: (id) => `/finans/hesap/${id}`, fin_cheques: (id) => `/finans/cek-senet/${id}`,
  fin_loans: (id) => `/finans/krediler/${id}`, jobs: (id) => `/isler/${id}`, stk_items: (id) => `/stok/urunler/${id}`, stk_counts: (id) => `/stok/sayim/${id}`, stk_transfers: (id) => `/stok/transfer/${id}`,
  employees: (id) => `/personel/${id}`, lab_customers: (id) => `/isler/hekimler/${id}`,
};
export const ago = (s: string | null) => {
  if (!s) return "hiç";
  const m = Math.round((Date.now() - new Date(s).getTime()) / 60000);
  return m < 1 ? "şimdi" : m < 60 ? `${m} dk önce` : m < 1440 ? `${Math.round(m / 60)} sa önce` : `${Math.round(m / 1440)} gün önce`;
};
export const clock = (s: string) => new Date(s).toLocaleString("tr-TR", { timeZone: "Europe/Istanbul", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
