// Genel fiyat listesi: istemci ve sunucuda kullanılabilen tipler ve yardımcılar
import type { I18nText, Locale } from "./i18n";

export type PriceItem = {
  id: string;
  section: I18nText;
  name: I18nText;
  unit: I18nText;
  note: I18nText;
  price_try: number | null;
  price_eur: number | null;
  sort: number;
  is_active: boolean;
  updated_at?: string;
};

export function formatPrice(v: number | null, currency: "TRY" | "EUR", locale: Locale): string {
  if (v === null || v === undefined) return "—";
  return new Intl.NumberFormat(locale === "tr" ? "tr-TR" : locale === "fr" ? "fr-FR" : "en-GB", { style: "currency", currency, maximumFractionDigits: 2 }).format(Number(v));
}

export const PRICE_UI: Record<
  Locale,
  {
    title: string;
    lead: string;
    request: string;
    requested: string;
    requestedText: string;
    noAccess: string;
    inactive: string;
    item: string;
    unit: string;
    try: string;
    eur: string;
    print: string;
    updated: string;
    vat: string;
    empty: string;
    error: string;
    sent: string;
    nav: string;
  }
> = {
  tr: {
    title: "Genel fiyat listesi",
    lead: "Laboratuvarımızın güncel genel fiyatları. Özel anlaşmalar ve kampanyalar için bizimle iletişime geçin.",
    request: "Fiyat listesini talep et",
    requested: "Talebiniz alındı",
    requestedText: "Ekibimiz hesabınızı inceleyip fiyat listesine erişim verecek; onaylandığında liste bu sayfada görünür.",
    noAccess: "Fiyat listemiz yalnız onayladığımız hekim, klinik ve aracı kuruluşlara açıktır. Aşağıdaki düğmeyle talep edebilirsiniz.",
    inactive: "Hesabınız onaylandıktan sonra fiyat listesini talep edebilirsiniz.",
    item: "Ürün / hizmet",
    unit: "Birim",
    try: "TL",
    eur: "EUR",
    print: "Yazdır / PDF",
    updated: "Son güncelleme",
    vat: "Fiyatlara KDV dahil değildir. Kargo ve özel işlemler ayrıca fiyatlandırılır.",
    empty: "Fiyat listesi henüz hazırlanmadı.",
    error: "Talep gönderilemedi, lütfen tekrar deneyin.",
    sent: "Talebiniz iletildi.",
    nav: "Fiyat listesi",
  },
  en: {
    title: "General price list",
    lead: "Our laboratory's current general prices. Contact us for special agreements and offers.",
    request: "Request the price list",
    requested: "Request received",
    requestedText: "Our team will review your account and grant access; once approved, the list appears on this page.",
    noAccess: "Our price list is available only to doctors, clinics and agencies we have approved. You can request access below.",
    inactive: "You can request the price list once your account is approved.",
    item: "Product / service",
    unit: "Unit",
    try: "TRY",
    eur: "EUR",
    print: "Print / PDF",
    updated: "Last updated",
    vat: "Prices exclude VAT. Shipping and special work are priced separately.",
    empty: "The price list has not been published yet.",
    error: "The request could not be sent, please try again.",
    sent: "Your request has been sent.",
    nav: "Price list",
  },
  fr: {
    title: "Liste de prix générale",
    lead: "Les tarifs généraux actuels de notre laboratoire. Contactez-nous pour les accords spécifiques et les offres.",
    request: "Demander la liste de prix",
    requested: "Demande reçue",
    requestedText: "Notre équipe examinera votre compte et vous donnera accès ; après validation, la liste apparaîtra sur cette page.",
    noAccess: "Notre liste de prix est réservée aux praticiens, cliniques et intermédiaires que nous avons validés. Vous pouvez en faire la demande ci-dessous.",
    inactive: "Vous pourrez demander la liste de prix une fois votre compte validé.",
    item: "Produit / service",
    unit: "Unité",
    try: "TRY",
    eur: "EUR",
    print: "Imprimer / PDF",
    updated: "Dernière mise à jour",
    vat: "Prix hors TVA. L’expédition et les travaux spécifiques sont facturés séparément.",
    empty: "La liste de prix n’est pas encore publiée.",
    error: "La demande n’a pas pu être envoyée, veuillez réessayer.",
    sent: "Votre demande a été envoyée.",
    nav: "Liste de prix",
  },
};
