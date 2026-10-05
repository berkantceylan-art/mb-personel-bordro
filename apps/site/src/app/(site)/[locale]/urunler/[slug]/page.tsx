import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CaseCard } from "@/components/CaseCard";
import { RichText } from "@/components/RichText";
import { SiteFooter, SiteHeader } from "@/components/SiteChrome";
import { breadcrumbJsonLd, ldScript } from "@/lib/seo";
import { mediaUrl, publicCases, publicProduct, publicProducts } from "@/lib/cms";
import { CASE_UI, DICTS, LOCALES, PRODUCT_UI, isLocale, t } from "@/lib/i18n";

export const revalidate = 60;

const PRICE_CTA = {
  tr: { title: "Fiyat listesi", text: "Onaylı hekim ve kliniklere portalda açık. Talep edin." },
  en: { title: "Price list", text: "Available in the portal to approved doctors and clinics. Request it." },
  fr: { title: "Liste de prix", text: "Accessible sur le portail aux praticiens validés. Demandez-la." },
} as const;

type Params = Promise<{ locale: string; slug: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { locale, slug } = await params;
  if (!isLocale(locale)) return {};
  const p = await publicProduct(slug);
  if (!p) return {};
  const title = t(p.seo_title, locale) || `${t(p.name, locale)} — MB Dental`;
  const description = t(p.seo_description, locale) || t(p.summary, locale);
  const img = mediaUrl(p.image_path);
  return {
    title,
    description,
    alternates: { canonical: `/${locale}/urunler/${slug}`, languages: Object.fromEntries(LOCALES.map((l) => [l, `/${l}/urunler/${slug}`])) },
    openGraph: { title, description, siteName: "MB Dental", locale, images: img ? [img] : undefined },
  };
}

export default async function ProductPage({ params }: { params: Params }) {
  const { locale, slug } = await params;
  if (!isLocale(locale)) notFound();
  const p = await publicProduct(slug);
  if (!p) notFound();

  const ui = PRODUCT_UI[locale];
  const d = DICTS[locale];
  const name = t(p.name, locale);
  const summary = t(p.summary, locale);
  const body = t(p.body, locale);
  const highlights = t(p.highlights, locale)
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  const img = mediaUrl(p.image_path);
  const gallery = p.gallery.map((g) => mediaUrl(g)).filter((u): u is string => !!u);
  const [allProducts, cases] = await Promise.all([publicProducts(), publicCases({ product: p.slug })]);
  const siblings = allProducts.filter((x) => x.category === p.category && x.id !== p.id).slice(0, 3);
  const caseHref = `/${locale}/vaka-gonder?urun=${p.slug}`;
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? "https://mbdentaire.com";

  const crumbs = breadcrumbJsonLd([
    { name: "MB Dental", path: `/${locale}` },
    { name: ui.all, path: `/${locale}/urunler` },
    { name, path: `/${locale}/urunler/${p.slug}` },
  ]);
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name,
    description: summary || undefined,
    image: img ?? undefined,
    category: ui.categories[p.category],
    brand: { "@type": "Brand", name: "MB Dental" },
    url: `${site}/${locale}/urunler/${p.slug}`,
  };

  return (
    <>
      <SiteHeader locale={locale} altPath={`/urunler/${p.slug}`} current="products" />
      <main>
        <section className="bg-navy text-white">
          <div className={`mx-auto grid max-w-6xl items-center gap-12 px-4 pb-16 pt-8 sm:px-6 lg:pb-20 ${img ? "lg:grid-cols-[1fr_1.05fr]" : ""}`}>
            <div className="min-w-0">
              <nav aria-label="Konum" className="text-sm text-white/65">
                <Link href={`/${locale}/urunler`} className="hover:text-white">
                  {ui.all}
                </Link>
                <span aria-hidden="true"> / </span>
                <Link href={`/${locale}/urunler#${p.category}`} className="hover:text-white">
                  {ui.categories[p.category]}
                </Link>
              </nav>
              <h1 className="display mt-5 text-5xl font-semibold leading-[0.98] tracking-tight sm:text-7xl">{name}</h1>
              {summary && <p className="mt-6 max-w-xl text-xl leading-relaxed text-white/80">{summary}</p>}
              <div className="mt-8 flex flex-wrap gap-3">
                <Link href={caseHref} className="rounded-full bg-smile px-6 py-3 font-semibold text-navy hover:bg-white">
                  {ui.send}
                </Link>
                <Link href="/giris" className="rounded-full border border-white/30 px-6 py-3 font-semibold hover:border-white">
                  {d.nav.login}
                </Link>
              </div>
            </div>
            {img && (
              <div className="aspect-[5/4] overflow-hidden rounded-[1.75rem] bg-navy-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={img} alt={name} className="h-full w-full object-cover" />
              </div>
            )}
          </div>
        </section>

        <div className="mx-auto flex max-w-6xl flex-wrap items-start gap-12 px-4 py-16 sm:px-6 lg:gap-16 lg:py-20">
          <article className="min-w-0 flex-[999_1_34rem] text-lg">
            {body ? <RichText text={body} /> : <p className="text-slate">{summary}</p>}
            {gallery.length > 0 && (
              <ul className="mt-10 grid grid-cols-2 gap-4">
                {gallery.map((g, i) => (
                  <li key={g} className="aspect-[4/3] overflow-hidden rounded-2xl bg-gypsum">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={g} alt={`${name} ${i + 1}`} className="h-full w-full object-cover" loading="lazy" />
                  </li>
                ))}
              </ul>
            )}
          </article>

          <aside className="grid min-w-0 flex-[1_1_18rem] gap-5 lg:sticky lg:top-6">
            {highlights.length > 0 && (
              <div className="rounded-3xl border border-gypsum bg-white p-7">
                <h2 className="display text-xl font-semibold text-navy">{ui.highlights}</h2>
                <ul className="mt-4 grid gap-3">
                  {highlights.map((h) => (
                    <li key={h} className="flex gap-3 text-[15px]">
                      <span aria-hidden="true" className="mt-2 h-2 w-2 shrink-0 rounded-full bg-smile" />
                      {h}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="rounded-3xl bg-navy p-7 text-white">
              <h2 className="display text-xl font-semibold">{ui.cta}</h2>
              <p className="mt-2 text-[15px] leading-relaxed text-white/75">{ui.ctaText}</p>
              <Link href={caseHref} className="mt-5 inline-block rounded-full bg-smile px-5 py-3 font-semibold text-navy hover:bg-white">
                {ui.send}
              </Link>
            </div>
            <Link href="/portal/fiyat-listesi" className="group flex items-center gap-4 rounded-3xl border border-gypsum bg-white p-6 hover:border-navy">
              <span aria-hidden="true" className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-porcelain text-lg text-navy">
                ₺
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-semibold text-navy">{PRICE_CTA[locale].title}</span>
                <span className="block text-sm text-slate">{PRICE_CTA[locale].text}</span>
              </span>
              <span aria-hidden="true" className="text-slate transition-transform group-hover:translate-x-1">
                →
              </span>
            </Link>
          </aside>
        </div>

        {cases.length > 0 && (
          <section aria-labelledby="urun-vakalar" className="border-t border-gypsum">
            <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
              <h2 id="urun-vakalar" className="display text-2xl font-semibold text-navy">
                {CASE_UI[locale].title}
              </h2>
              <ul className="mt-6 grid gap-10 sm:grid-cols-2 lg:grid-cols-3">
                {cases.slice(0, 6).map((c) => (
                  <li key={c.id}>
                    <CaseCard c={c} locale={locale} />
                  </li>
                ))}
              </ul>
            </div>
          </section>
        )}

        {siblings.length > 0 && (
          <section aria-labelledby="ayni-grup" className="border-t border-gypsum bg-white">
            <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
              <div className="flex flex-wrap items-baseline justify-between gap-4">
                <h2 id="ayni-grup" className="display text-2xl font-semibold text-navy">
                  {ui.others}
                </h2>
                <Link href={`/${locale}/urunler`} className="text-sm font-semibold text-smile-ink hover:underline">
                  {ui.back} →
                </Link>
              </div>
              <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {siblings.map((s) => (
                  <li key={s.id}>
                    <Link href={`/${locale}/urunler/${s.slug}`} className="block h-full rounded-2xl border border-gypsum p-5 hover:border-navy">
                      <span className="block text-lg font-semibold text-ink">{t(s.name, locale)}</span>
                      <span className="mt-1 block text-sm text-slate">{t(s.summary, locale)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          </section>
        )}
      </main>
      <SiteFooter locale={locale} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: ldScript([jsonLd, crumbs]) }} />
    </>
  );
}
