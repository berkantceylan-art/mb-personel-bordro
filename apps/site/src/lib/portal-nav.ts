// Hekim portalı menüsü: modül grupları ve menü metinleri (TR/EN/FR)
import type { NavGroup, RailLabels } from "@/components/RailNav";
import type { Locale } from "./i18n";
import { ACCT_UI } from "./portal-account-ui";
import { PX } from "./portal-extra-ui";
import { PORTAL_UI } from "./portal-ui";
import { PRICE_UI } from "./prices";
import { SHIP_UI } from "./shipments-portal";
import { TEAM_UI } from "./portal-team-ui";

const T: Record<Locale, { cases: string; ship: string; account: string; team: string; d: Record<string, string> }> = {
  tr: {
    cases: "Vakalar", ship: "Kargo", account: "Hesap", team: "Ekip",
    d: { list: "Gönderdiğiniz vakalar ve aşamaları", new: "Dosya yükleyin ya da ölçü gönderin", notif: "Laboratuvardan gelen güncellemeler", ship: "Kargo bildirin, kurye isteyin, paketleri izleyin", acct: "İşler, cari ekstre ve proforma", price: "Güncel ürün fiyatları", team: "Hesaptaki kişiler, davet kodu, logo", clients: "Vaka gönderdiğiniz hekim ve klinikler" },
  },
  en: {
    cases: "Cases", ship: "Shipping", account: "Account", team: "Team",
    d: { list: "Your cases and their stages", new: "Upload files or send an impression", notif: "Updates from the lab", ship: "Announce parcels, book a courier, track", acct: "Jobs, statement and pro forma", price: "Current product prices", team: "People, invitation codes, logo", clients: "Dentists and clinics you send cases for" },
  },
  fr: {
    cases: "Cas", ship: "Expédition", account: "Compte", team: "Équipe",
    d: { list: "Vos cas et leurs étapes", new: "Téléversez des fichiers ou envoyez une empreinte", notif: "Mises à jour du laboratoire", ship: "Annoncez un colis, demandez un coursier, suivez", acct: "Travaux, relevé et proforma", price: "Prix actuels des produits", team: "Membres, codes d’invitation, logo", clients: "Praticiens et cabinets pour lesquels vous envoyez des cas" },
  },
};

export function portalNav(locale: Locale, accountType: string): NavGroup[] {
  const t = T[locale];
  const ui = PORTAL_UI[locale];
  const team = TEAM_UI[locale];
  return [
    {
      slug: "vakalar", title: t.cases, short: t.cases,
      items: [
        { href: "/portal", label: ui.nav.cases, desc: t.d.list },
        { href: "/portal/vaka/yeni", label: ui.nav.newCase, desc: t.d.new },
        { href: "/portal/bildirimler", label: PX[locale].notifNav, desc: t.d.notif },
      ],
    },
    { slug: "lojistik", title: t.ship, short: t.ship, items: [{ href: "/portal/paketler", label: SHIP_UI[locale].nav, desc: t.d.ship }] },
    {
      slug: "hesap", title: t.account, short: t.account,
      items: [
        { href: "/portal/hesap", label: ACCT_UI[locale].nav, desc: t.d.acct },
        { href: "/portal/fiyat-listesi", label: PRICE_UI[locale].nav, desc: t.d.price },
      ],
    },
    {
      slug: "ekip", title: t.team, short: t.team,
      items: [
        ...(accountType === "agency" || accountType === "clinic" ? [{ href: "/portal/musteriler", label: team.clientsNav, desc: t.d.clients }] : []),
        { href: "/portal/ekip", label: team.teamNav, desc: t.d.team },
      ],
    },
  ];
}

export const PORTAL_RAIL: Record<Locale, RailLabels> = {
  tr: {
    search: "Ara", placeholder: "Sayfa ara… (ör. yeni vaka, paket, ekstre)", favorites: "Sık kullanılanlar", favShort: "Favori",
    favEmpty: "Bir sayfanın yanındaki yıldıza basın; burada hep elinizin altında olsun.", recent: "Son açılanlar", all: "Tümü",
    collapse: "Menüyü daralt", expand: "Menüyü genişlet", menu: "Menü", close: "Kapat", noResults: "Sonuç yok", select: "seç", open: "aç", anywhere: "her yerden aç",
    addFav: "sık kullanılanlara ekle", removeFav: "sık kullanılanlardan çıkar", module: "",
  },
  en: {
    search: "Search", placeholder: "Search pages… (e.g. new case, parcel, statement)", favorites: "Favourites", favShort: "Starred",
    favEmpty: "Tap the star next to a page to keep it here.", recent: "Recently opened", all: "All",
    collapse: "Collapse menu", expand: "Expand menu", menu: "Menu", close: "Close", noResults: "No results", select: "select", open: "open", anywhere: "open anywhere",
    addFav: "add to favourites", removeFav: "remove from favourites", module: "",
  },
  fr: {
    search: "Rechercher", placeholder: "Rechercher une page… (ex. nouveau cas, colis, relevé)", favorites: "Favoris", favShort: "Favoris",
    favEmpty: "Touchez l’étoile à côté d’une page pour la garder ici.", recent: "Récemment ouverts", all: "Tout",
    collapse: "Réduire le menu", expand: "Agrandir le menu", menu: "Menu", close: "Fermer", noResults: "Aucun résultat", select: "choisir", open: "ouvrir", anywhere: "ouvrir partout",
    addFav: "ajouter aux favoris", removeFav: "retirer des favoris", module: "",
  },
};
