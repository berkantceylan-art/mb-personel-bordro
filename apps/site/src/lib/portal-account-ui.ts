// Portal "Hesabım": işler, cari ekstre, proforma (TR/EN/FR)
import type { Locale } from "./i18n";

export type LJob = { id: string; no: number; in_date: string; due_date: string | null; patient: string | null; doctor_name: string | null; total: number; currency: string; status: string; delivered_at: string | null };
export type LPay = { id: string; paid_on: string; amount: number; method: string; ref: string | null };

export function fmtMoney(minor: number, currency: string, locale: Locale) {
  return new Intl.NumberFormat(locale === "tr" ? "tr-TR" : locale === "fr" ? "fr-FR" : "en-GB", { style: "currency", currency, minimumFractionDigits: 2 }).format((Number(minor) || 0) / 100);
}

type A = {
  nav: string;
  title: string;
  lead: string;
  notLinked: string;
  balance: string;
  billed: string;
  paid: string;
  jobs: string;
  statement: string;
  proforma: string;
  month: string;
  no: string;
  patient: string;
  doctor: string;
  inDate: string;
  due: string;
  amount: string;
  status: string;
  date: string;
  desc: string;
  debit: string;
  credit: string;
  runBal: string;
  payment: string;
  job: string;
  empty: string;
  print: string;
  bank: string;
  total: string;
  qty: string;
  unit: string;
  item: string;
  proformaTitle: string;
  proformaNote: string;
  billTo: string;
  jobStatus: Record<string, string>;
  methods: Record<string, string>;
};

export const ACCT_UI: Record<Locale, A> = {
  tr: {
    nav: "Hesabım",
    title: "Hesabım",
    lead: "Laboratuvara kayıtlı işleriniz, tahsilatlarınız ve güncel bakiyeniz.",
    notLinked: "Hesabınız henüz laboratuvar cari kartına bağlanmadı. Laboratuvar bağladığında işleriniz burada görünür.",
    balance: "Güncel bakiye",
    billed: "Toplam iş tutarı",
    paid: "Toplam ödeme",
    jobs: "İşlerim",
    statement: "Hesap ekstresi",
    proforma: "Aylık proforma",
    month: "Ay",
    no: "İş no",
    patient: "Hasta",
    doctor: "Doktor",
    inDate: "Giriş",
    due: "Teslim",
    amount: "Tutar",
    status: "Durum",
    date: "Tarih",
    desc: "Açıklama",
    debit: "Borç",
    credit: "Alacak",
    runBal: "Bakiye",
    payment: "Ödeme",
    job: "İş",
    empty: "Kayıt yok.",
    print: "Yazdır / PDF",
    bank: "Banka bilgileri",
    total: "Toplam",
    qty: "Adet",
    unit: "Birim fiyat",
    item: "Ürün",
    proformaTitle: "Proforma fatura",
    proformaNote: "Bu belge bilgi amaçlıdır; resmi fatura ayrıca düzenlenir.",
    billTo: "Sayın",
    jobStatus: { open: "Üretimde", tryin: "Provada", ready: "Hazır", delivered: "Teslim edildi", cancelled: "İptal" },
    methods: { cash: "Nakit", bank: "Havale / EFT", card: "Kredi kartı", check: "Çek / senet", offset: "Mahsup", other: "Diğer" },
  },
  en: {
    nav: "My account",
    title: "My account",
    lead: "Your jobs registered at the lab, your payments and current balance.",
    notLinked: "Your account is not linked to a lab ledger yet. Your jobs will appear here once the lab links it.",
    balance: "Current balance",
    billed: "Total billed",
    paid: "Total paid",
    jobs: "My jobs",
    statement: "Account statement",
    proforma: "Monthly pro forma",
    month: "Month",
    no: "Job no",
    patient: "Patient",
    doctor: "Doctor",
    inDate: "Received",
    due: "Due",
    amount: "Amount",
    status: "Status",
    date: "Date",
    desc: "Description",
    debit: "Debit",
    credit: "Credit",
    runBal: "Balance",
    payment: "Payment",
    job: "Job",
    empty: "No records.",
    print: "Print / PDF",
    bank: "Bank details",
    total: "Total",
    qty: "Qty",
    unit: "Unit price",
    item: "Item",
    proformaTitle: "Pro forma invoice",
    proformaNote: "This document is for information only; the official invoice is issued separately.",
    billTo: "Bill to",
    jobStatus: { open: "In production", tryin: "Try-in", ready: "Ready", delivered: "Delivered", cancelled: "Cancelled" },
    methods: { cash: "Cash", bank: "Bank transfer", card: "Card", check: "Cheque", offset: "Offset", other: "Other" },
  },
  fr: {
    nav: "Mon compte",
    title: "Mon compte",
    lead: "Vos travaux enregistrés au laboratoire, vos paiements et votre solde actuel.",
    notLinked: "Votre compte n’est pas encore rattaché à une fiche client du laboratoire. Vos travaux apparaîtront ici dès le rattachement.",
    balance: "Solde actuel",
    billed: "Total facturé",
    paid: "Total payé",
    jobs: "Mes travaux",
    statement: "Relevé de compte",
    proforma: "Proforma mensuelle",
    month: "Mois",
    no: "N° travail",
    patient: "Patient",
    doctor: "Praticien",
    inDate: "Réception",
    due: "Livraison",
    amount: "Montant",
    status: "Statut",
    date: "Date",
    desc: "Libellé",
    debit: "Débit",
    credit: "Crédit",
    runBal: "Solde",
    payment: "Paiement",
    job: "Travail",
    empty: "Aucun enregistrement.",
    print: "Imprimer / PDF",
    bank: "Coordonnées bancaires",
    total: "Total",
    qty: "Qté",
    unit: "Prix unitaire",
    item: "Article",
    proformaTitle: "Facture proforma",
    proformaNote: "Document à titre informatif ; la facture officielle est émise séparément.",
    billTo: "Facturé à",
    jobStatus: { open: "En production", tryin: "Essayage", ready: "Prêt", delivered: "Livré", cancelled: "Annulé" },
    methods: { cash: "Espèces", bank: "Virement", card: "Carte", check: "Chèque", offset: "Compensation", other: "Autre" },
  },
};
