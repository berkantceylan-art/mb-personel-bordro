/** Günlük irsaliye ve ay sonu fatura (iç hesap): etiketler ve belge dilleri */

export const WB_STATUS: Record<string, [string, string]> = {
  open: ["Açık (gün içinde eklenir)", "bg-[#EAF2FB] text-brand-700"],
  issued: ["Kesildi", "bg-ok-bg text-ok"],
  cancelled: ["İptal", "bg-[#EEF2F6] text-muted"],
};

export const wbNo = (year: number, no: number) => `İRS-${year}-${String(no).padStart(5, "0")}`;
export const stNo = (year: number, no: number) => `MB-${year}-${String(no).padStart(4, "0")}`;

export const LANGS: Record<string, string> = { tr: "Türkçe", en: "English", fr: "Français" };

type Dict = {
  waybill: string; invoice: string; no: string; date: string; customer: string; period: string; due: string; job: string; patient: string; doctor: string;
  work: string; qty: string; unit: string; amount: string; total: string; units: string; jobs: string; delivered_by: string; received_by: string;
  bank: string; note: string; page_sub_wb: string; page_sub_inv: string; waybills: string; tax: string; thanks: string; subtotal: string; shade: string;
};

export const DOC: Record<string, Dict> = {
  tr: {
    waybill: "SEVK İRSALİYESİ", invoice: "FATURA", no: "No", date: "Tarih", customer: "Müşteri", period: "Dönem", due: "Son ödeme", job: "İş", patient: "Hasta", doctor: "Hekim",
    work: "Yapılan iş", qty: "Adet", unit: "Birim fiyat", amount: "Tutar", total: "Genel toplam", units: "birim", jobs: "iş", delivered_by: "Teslim eden", received_by: "Teslim alan",
    bank: "Banka bilgileri", note: "Not", page_sub_wb: "Günlük teslim listesi", page_sub_inv: "Aylık toplu fatura", waybills: "İrsaliyeler", tax: "Vergi no", thanks: "Teşekkür ederiz.", subtotal: "Ara toplam", shade: "Renk",
  },
  en: {
    waybill: "DELIVERY NOTE", invoice: "INVOICE", no: "No", date: "Date", customer: "Customer", period: "Period", due: "Due date", job: "Case", patient: "Patient", doctor: "Doctor",
    work: "Work", qty: "Qty", unit: "Unit price", amount: "Amount", total: "Total", units: "units", jobs: "cases", delivered_by: "Delivered by", received_by: "Received by",
    bank: "Bank details", note: "Note", page_sub_wb: "Daily delivery list", page_sub_inv: "Monthly invoice", waybills: "Delivery notes", tax: "Tax ID", thanks: "Thank you for your business.", subtotal: "Subtotal", shade: "Shade",
  },
  fr: {
    waybill: "BON DE LIVRAISON", invoice: "FACTURE", no: "N°", date: "Date", customer: "Client", period: "Période", due: "Échéance", job: "Cas", patient: "Patient", doctor: "Praticien",
    work: "Travail", qty: "Qté", unit: "Prix unitaire", amount: "Montant", total: "Total", units: "unités", jobs: "cas", delivered_by: "Livré par", received_by: "Reçu par",
    bank: "Coordonnées bancaires", note: "Remarque", page_sub_wb: "Liste de livraison du jour", page_sub_inv: "Facture mensuelle", waybills: "Bons de livraison", tax: "N° TVA", thanks: "Merci de votre confiance.", subtotal: "Sous-total", shade: "Teinte",
  },
};

const LOCALE: Record<string, string> = { tr: "tr-TR", en: "en-GB", fr: "fr-FR" };
const SYM: Record<string, string> = { TRY: "₺", EUR: "€", USD: "$" };

export const docMoney = (minor: number | null | undefined, cur: string, lang: string) =>
  `${(Number(minor ?? 0) / 100).toLocaleString(LOCALE[lang] ?? "tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${SYM[cur] ?? cur}`;
export const docDate = (iso: string, lang: string) => new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString(LOCALE[lang] ?? "tr-TR");

export function waybillError(m: string): string {
  if (/waybill_invoiced/.test(m)) return "Bu irsaliye faturalanmış; önce faturayı iptal edin.";
  if (/nothing_to_invoice/.test(m)) return "Bu dönemde faturalanacak irsaliye yok.";
  if (/jobs_invalid/.test(m)) return "Seçilen işlerden biri teslim edilmemiş, başka müşteriye ait ya da zaten irsaliyede.";
  if (/jobs_required/.test(m)) return "İş seçin.";
  if (/account_required/.test(m)) return "Resmi hesaba işlenecek tahsilat için kasa / banka seçin.";
  if (/party_missing/.test(m)) return "Bu müşterinin resmi cari kartı yok (Finans › Cari kartlar).";
  if (/bad_period/.test(m)) return "Dönem hatalı.";
  if (/not_allowed/.test(m)) return "Bu işlem için yetkiniz yok.";
  if (/lab_waybill|lab_statement|lab_payment_add|lab_billing|internal_book|schema cache/.test(m)) return "Supabase'de 20261211000000_waybills.sql çalıştırılmalı.";
  return m;
}
