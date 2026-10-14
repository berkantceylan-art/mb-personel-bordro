import type { Area } from "./cms";
import { t, type Locale } from "./i18n";

/** Türkçe bulunma eki: İzmir'de, Ankara'da, Fransa'da, Bursa'da */
function locTr(name: string) {
  const v = [...name.toLocaleLowerCase("tr")].reverse().find((c) => "aeıioöuü".includes(c)) ?? "e";
  const last = name.toLocaleLowerCase("tr").slice(-1);
  const d = "çfhkpsşt".includes(last) ? "t" : "d";
  return `${name}'${d}${"aıou".includes(v) ? "a" : "e"}`;
}

/** Bölge sayfası metinleri: yöneticinin yazdığı yoksa şablondan */
export function areaText(a: Area, locale: Locale) {
  const name = t(a.name, locale) || a.slug;
  const d = a.shipping_days;
  const T = {
    tr: {
      title: a.kind === "city" ? `${name} diş protez laboratuvarı` : `${name} için Türk diş laboratuvarı`,
      intro: a.kind === "city"
        ? `${locTr(name)}ki diş hekimleri ve klinikler için zirkonyum, E.max, implant üstü protez ve dijital (STL) vaka hizmeti. Vakanızı portaldan gönderin, kuryeyle alalım; ${d === 0 ? "aynı gün" : d ? `${d} iş günü içinde` : "kısa sürede"} teslim edelim.`
        : `${locTr(name)}ki diş hekimleri için İzmir'den zirkonyum kron, köprü, implant üstü ve estetik protez. Ağız içi tarama (STL) ile dijital vaka; ${d ? `kapıdan kapıya yaklaşık ${d} iş günü` : "hızlı uluslararası kargo"}.`,
      delivery: d === 0 ? "Aynı gün kurye" : d ? `${d} iş günü teslim` : "Hızlı teslim",
      why: ["Dijital vaka: STL / ağız içi tarama kabul", "Her aşamayı portaldan izleme", "Uygunluk beyanı ve malzeme lot takibi", "Türkçe, İngilizce, Fransızca destek"],
      products: "Ürünlerimiz", send: "Vaka gönder", contact: "Bize ulaşın", areas: "Hizmet verdiğimiz diğer bölgeler", crumbs: "Hizmet bölgeleri",
    },
    en: {
      title: a.kind === "city" ? `Dental laboratory in ${name}` : `Turkish dental laboratory for ${name}`,
      intro: a.kind === "city"
        ? `Zirconia, E.max, implant-supported and digital (STL) cases for dentists and clinics in ${name}. Send your case through the portal; ${d === 0 ? "same-day delivery" : d ? `delivery within ${d} working days` : "fast delivery"}.`
        : `Zirconia crowns, bridges, implant and aesthetic prosthetics from Izmir for dentists in ${name}. Digital cases via intraoral scans (STL); ${d ? `about ${d} working days door to door` : "fast international shipping"}.`,
      delivery: d === 0 ? "Same-day courier" : d ? `${d} working days` : "Fast delivery",
      why: ["Digital cases: STL / intraoral scans accepted", "Follow every stage in the portal", "Declaration of conformity and material lot tracking", "Support in Turkish, English and French"],
      products: "Our products", send: "Send a case", contact: "Contact us", areas: "Other areas we serve", crumbs: "Service areas",
    },
    fr: {
      title: a.kind === "city" ? `Laboratoire dentaire à ${name}` : `Laboratoire dentaire turc pour ${name === "France" ? "la France" : name}`,
      intro: a.kind === "city"
        ? `Zircone, E.max, prothèses sur implants et cas numériques (STL) pour les cabinets de ${name}. Envoyez votre cas via le portail ; ${d === 0 ? "livraison le jour même" : d ? `livraison sous ${d} jours ouvrés` : "livraison rapide"}.`
        : `Couronnes zircone, bridges, prothèses sur implants et esthétiques depuis Izmir pour les praticiens en ${name}. Cas numériques par empreinte optique (STL) ; ${d ? `environ ${d} jours ouvrés de porte à porte` : "expédition internationale rapide"}.`,
      delivery: d === 0 ? "Coursier le jour même" : d ? `${d} jours ouvrés` : "Livraison rapide",
      why: ["Cas numériques : fichiers STL / empreintes optiques", "Suivi de chaque étape sur le portail", "Déclaration de conformité et traçabilité des lots", "Assistance en turc, anglais et français"],
      products: "Nos produits", send: "Envoyer un cas", contact: "Nous contacter", areas: "Autres zones desservies", crumbs: "Zones desservies",
    },
  }[locale];
  return { ...T, name, title: t(a.title, locale) || T.title, intro: t(a.intro, locale) || T.intro, delivery: t(a.delivery, locale) || T.delivery, body: t(a.body, locale) };
}
