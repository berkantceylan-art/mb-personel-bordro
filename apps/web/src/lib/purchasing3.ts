/** Satın alma 3. aşama (eşleştirme, bütçe, rapor) — istemci ve sunucu ortak */

export const MATCH_STATUS: Record<string, [string, string]> = {
  waiting: ["Fatura bekleniyor", "bg-[#EEF2F6] text-muted"],
  partial: ["Kısmi", "bg-[#EEF4FB] text-brand-700"],
  ok: ["Eşleşti", "bg-ok-bg text-ok"],
  diff: ["Fark var", "bg-bad-bg text-bad"],
  accepted: ["Fark kabul edildi", "bg-warn-bg text-warn"],
};

export const LINE_STATUS: Record<string, [string, string]> = {
  waiting: ["Gelmedi", "bg-[#EEF2F6] text-muted"],
  not_invoiced: ["Geldi, faturası yok", "bg-[#EEF4FB] text-brand-700"],
  partial: ["Kısmi faturalandı", "bg-[#EEF4FB] text-brand-700"],
  ok: ["Tamam", "bg-ok-bg text-ok"],
  over_billed: ["Gelenden fazla faturalandı", "bg-bad-bg text-bad"],
  price_up: ["Fatura fiyatı yüksek", "bg-bad-bg text-bad"],
  extra: ["Siparişte yok", "bg-bad-bg text-bad"],
};

export const MONTHS = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];

export type MatchLine = { sort: number; line_id: string | null; name: string; unit: string; ordered: number; received: number; basis: number; invoiced: number; po_price: number; inv_price: number | null; inv_amount: number; status: string; two_way: boolean };
export type MatchRow = { po_id: string; year: number; no: number; party_id: string; party: string; order_date: string; status: string; currency: string; ordered: number; received: number; invoiced: number; diff: number; invoices: number; issues: number; match: string; ok_note: string | null };
export type Unlinked = { invoice_id: string; doc_no: string | null; invoice_date: string; party_id: string; party: string; total: number; currency: string; status: string; candidates: { id: string; no: string; total: number; currency: string; date: string; status: string; has_invoice: boolean }[] };
export type BudgetCell = { category_id: string; name: string; kind: string; month: number; budget: number; actual: number; committed: number };

export function p3Error(m: string): string {
  if (/pur_match|pur_budget|pur_invoice_link|pur_unlinked|pur_report|pur_order_set_category|po_id|match_ok|budget_block|schema cache|does not exist/.test(m)) return "Supabase'de mbdental-satinalma-3.sql çalıştırılmalı.";
  if (/party_mismatch/.test(m)) return "Fatura ve sipariş farklı tedarikçinin.";
  if (/po_not_open/.test(m)) return "Sipariş bu işlem için uygun durumda değil.";
  if (/invoice_not_found/.test(m)) return "Alış faturası bulunamadı.";
  if (/note_required/.test(m)) return "Farkı neden kabul ettiğinizi yazın.";
  if (/not_allowed/.test(m)) return "Bu işlem için yetkiniz yok.";
  return m;
}

/** Bütçe kullanım oranı → renk */
export const budgetTone = (pct: number) => (pct > 100 ? "bg-bad" : pct >= 80 ? "bg-warn" : "bg-ok");
