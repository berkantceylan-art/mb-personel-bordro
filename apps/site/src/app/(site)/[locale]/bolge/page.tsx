import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SiteFooter, SiteHeader } from "@/components/SiteChrome";
import { publicAreas } from "@/lib/cms";
import { areaText } from "@/lib/area-text";
import { LOCALES, isLocale, type Locale } from "@/lib/i18n";

export const revalidate = 300;
const UI: Record<Locale, { title: string; lead: string; city: string; country: string }> = {
  tr: { title: "Hizmet verdiğimiz bölgeler", lead: "Türkiye'nin her yerine kurye ve kargo, Avrupa'ya kapıdan kapıya teslim.", city: "Türkiye", country: "Yurt dışı" },
  en: { title: "Areas we serve", lead: "Courier and shipping across Türkiye, door-to-door delivery to Europe.", city: "Türkiye", country: "Abroad" },
  fr: { title: "Zones desservies", lead: "Coursier et expédition dans toute la Turquie, livraison porte à porte en Europe.", city: "Turquie", country: "International" },
};

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  return { title: `${UI[locale].title} — MB Dental`, description: UI[locale].lead, alternates: { canonical: `/${locale}/bolge`, languages: Object.fromEntries(LOCALES.map((l) => [l, `/${l}/bolge`])) } };
}

export default async function AreasPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const areas = await publicAreas();
  const u = UI[locale];
  return (
    <>
      <SiteHeader locale={locale} altPath="/bolge" />
      <main className="mx-auto max-w-5xl px-4 py-14 sm:px-6">
        <h1 className="display text-4xl font-semibold text-navy sm:text-5xl">{u.title}</h1>
        <p className="mt-3 text-lg text-slate">{u.lead}</p>
        {(["city", "country"] as const).map((k) => (
          <section key={k} className="mt-10">
            <h2 className="display text-2xl font-semibold text-navy">{k === "city" ? u.city : u.country}</h2>
            <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {areas.filter((a) => a.kind === k).map((a) => {
                const x = areaText(a, locale);
                return <li key={a.id}><Link href={`/${locale}/bolge/${a.slug}`} className="block h-full rounded-2xl border border-gypsum bg-white p-5 hover:border-navy"><b className="text-lg text-ink">{x.name}</b><span className="mt-1 block text-sm text-slate">{x.delivery}</span></Link></li>;
              })}
            </ul>
          </section>
        ))}
      </main>
      <SiteFooter locale={locale} />
    </>
  );
}
