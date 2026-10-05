import { DICTS, type Locale } from "./i18n";
import type { SiteSettings } from "./settings";
import { telHref } from "./settings";

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export const siteUrl = () => process.env.NEXT_PUBLIC_SITE_URL ?? "https://mbdentaire.com";

/** Google işletme bilgisi (LocalBusiness alt türü): adres, saatler, iletişim, sosyal hesaplar */
export function businessJsonLd(st: SiteSettings, locale: Locale) {
  const site = siteUrl();
  const hours = st.schedule
    .map((r, i) => (r ? { "@type": "OpeningHoursSpecification", dayOfWeek: `https://schema.org/${DAYS[i]}`, opens: r.split("-")[0], closes: r.split("-")[1] } : null))
    .filter(Boolean);
  const [district, city] = st.address2.split("/").map((x) => x.trim());
  return {
    "@context": "https://schema.org",
    "@type": "MedicalBusiness",
    "@id": `${site}/#isletme`,
    name: "MB Dental",
    alternateName: "MB Dentaire",
    description: DICTS[locale].meta.description,
    url: `${site}/${locale}`,
    logo: `${site}/logo.svg`,
    telephone: telHref(st.phone).replace("tel:", ""),
    email: st.email,
    address: {
      "@type": "PostalAddress",
      streetAddress: st.address1,
      addressLocality: district || st.address2,
      addressRegion: city || undefined,
      addressCountry: "TR",
    },
    hasMap: st.map_url || undefined,
    openingHoursSpecification: hours.length ? hours : undefined,
    sameAs: Object.values(st.social).filter(Boolean),
    knowsLanguage: ["tr", "en", "fr"],
    areaServed: ["TR", "FR", "BE", "CH", "DE", "GB", "NL"],
    contactPoint: [
      {
        "@type": "ContactPoint",
        contactType: "customer support",
        telephone: telHref(st.phone).replace("tel:", ""),
        email: st.email,
        availableLanguage: ["Turkish", "English", "French"],
      },
    ],
  };
}

export function breadcrumbJsonLd(items: { name: string; path: string }[]) {
  const site = siteUrl();
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((x, i) => ({ "@type": "ListItem", position: i + 1, name: x.name, item: `${site}${x.path}` })),
  };
}

export const ldScript = (data: unknown) => JSON.stringify(data).replace(/</g, "\\u003c");
