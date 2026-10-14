import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FaqBlock } from "@/components/FaqBlock";
import { RichText } from "@/components/RichText";
import { SiteFooter, SiteHeader } from "@/components/SiteChrome";
import { publicArea, publicAreas, publicFaqs, publicProducts, scopedFaqs } from "@/lib/cms";
import { areaText } from "@/lib/area-text";
import { faqJsonLd } from "@/lib/faq-ld";
import { LOCALES, isLocale, t } from "@/lib/i18n";
import { breadcrumbJsonLd, ldScript, siteUrl } from "@/lib/seo";

export const revalidate = 300;
type Params = Promise<{ locale: string; slug: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { locale, slug } = await params;
  if (!isLocale(locale)) return {};
  const a = await publicArea(slug);
  if (!a) return {};
  const x = areaText(a, locale);
  return {
    title: `${x.title} — MB Dental`,
    description: x.intro.slice(0, 160),
    alternates: { canonical: `/${locale}/bolge/${slug}`, languages: Object.fromEntries(LOCALES.map((l) => [l, `/${l}/bolge/${slug}`])) },
    openGraph: { title: x.title, description: x.intro.slice(0, 160), siteName: "MB Dental", locale },
  };
}

/** Şehir / ülke hizmet sayfası: yerel arama ve yapay zekâ cevapları için */
export default async function AreaPage({ params }: { params: Params }) {
  const { locale, slug } = await params;
  if (!isLocale(locale)) notFound();
  const a = await publicArea(slug);
  if (!a) notFound();
  const x = areaText(a, locale);
  const [products, own, general, areas] = await Promise.all([publicProducts(), scopedFaqs({ area: slug }), publicFaqs(), publicAreas()]);
  const faqs = [...own, ...general.filter((f) => f.category === "teslimat" && !f.area_slug && !f.product_slug).slice(0, 4)];
  const site = siteUrl();
  const service = {
    "@context": "https://schema.org", "@type": "Service", name: x.title, description: x.intro, serviceType: "Dental laboratory",
    provider: { "@id": `${site}/#isletme` }, areaServed: { "@type": a.kind === "city" ? "City" : "Country", name: x.name },
    url: `${site}/${locale}/bolge/${slug}`,
  };
  const crumbs = breadcrumbJsonLd([{ name: "MB Dental", path: `/${locale}` }, { name: x.crumbs, path: `/${locale}/bolge` }, { name: x.name, path: `/${locale}/bolge/${slug}` }]);
  const fl = faqJsonLd(faqs, locale);
  return (
    <>
      <SiteHeader locale={locale} altPath={`/bolge/${slug}`} />
      <main>
        <section className="bg-navy text-white">
          <div className="mx-auto max-w-5xl px-4 pb-16 pt-10 sm:px-6">
            <nav className="text-sm text-white/65"><Link href={`/${locale}/bolge`} className="hover:text-white">{x.crumbs}</Link> / {x.name}</nav>
            <h1 className="display mt-5 text-4xl font-semibold leading-tight sm:text-6xl">{x.title}</h1>
            <p className="mt-6 max-w-3xl text-xl leading-relaxed text-white/80">{x.intro}</p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link href={`/${locale}/vaka-gonder`} className="rounded-full bg-smile px-6 py-3 font-semibold text-navy hover:bg-white">{x.send}</Link>
              <Link href={`/${locale}/iletisim`} className="rounded-full border border-white/30 px-6 py-3 font-semibold hover:border-white">{x.contact}</Link>
              <span className="rounded-full bg-white/10 px-4 py-2 text-sm">🚚 {x.delivery}</span>
            </div>
          </div>
        </section>
        <section className="mx-auto grid max-w-5xl gap-10 px-4 py-14 sm:px-6 lg:grid-cols-[1.4fr_1fr]">
          <div className="text-lg">
            {x.body ? <RichText text={x.body} /> : (
              <ul className="grid gap-3">{x.why.map((w) => <li key={w} className="flex gap-3"><span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-smile" />{w}</li>)}</ul>
            )}
          </div>
          <aside className="rounded-3xl border border-gypsum bg-white p-6">
            <h2 className="display text-xl font-semibold text-navy">{x.products}</h2>
            <ul className="mt-4 grid gap-2">
              {products.slice(0, 10).map((p) => <li key={p.id}><Link href={`/${locale}/urunler/${p.slug}`} className="text-ink hover:text-smile-ink hover:underline">{t(p.name, locale)}</Link></li>)}
            </ul>
          </aside>
        </section>
        <FaqBlock faqs={faqs} locale={locale} />
        <section className="border-t border-gypsum">
          <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6">
            <h2 className="display text-xl font-semibold text-navy">{x.areas}</h2>
            <ul className="mt-4 flex flex-wrap gap-2">
              {areas.filter((o) => o.slug !== slug).map((o) => <li key={o.id}><Link href={`/${locale}/bolge/${o.slug}`} className="inline-block rounded-full border border-gypsum px-4 py-2 text-sm hover:border-navy">{t(o.name, locale)}</Link></li>)}
            </ul>
          </div>
        </section>
      </main>
      <SiteFooter locale={locale} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: ldScript([service, crumbs, ...(fl ? [fl] : [])]) }} />
    </>
  );
}
