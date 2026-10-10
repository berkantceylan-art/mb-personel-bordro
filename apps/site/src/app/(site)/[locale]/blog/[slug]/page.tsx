import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { RichText } from "@/components/RichText";
import { SiteFooter, SiteHeader } from "@/components/SiteChrome";
import { mediaUrl, publicPost, publicPosts } from "@/lib/cms";
import { BLOG_UI } from "@/lib/growth-ui";
import { LOCALES, isLocale, t } from "@/lib/i18n";
import { breadcrumbJsonLd, ldScript, siteUrl } from "@/lib/seo";

export const revalidate = 300;
type Params = Promise<{ locale: string; slug: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { locale, slug } = await params;
  if (!isLocale(locale)) return {};
  const p = await publicPost(slug);
  if (!p) return {};
  const title = t(p.seo_title, locale) || `${t(p.title, locale)} — MB Dental`;
  const description = t(p.seo_description, locale) || t(p.summary, locale);
  const img = mediaUrl(p.image_path);
  return {
    title,
    description,
    alternates: { canonical: `/${locale}/blog/${slug}`, languages: Object.fromEntries(LOCALES.filter((l) => t(p.title, l)).map((l) => [l, `/${l}/blog/${slug}`])) },
    openGraph: { type: "article", title, description, siteName: "MB Dental", locale, publishedTime: p.publish_at, images: img ? [img] : undefined },
  };
}

export default async function BlogPost({ params }: { params: Params }) {
  const { locale, slug } = await params;
  if (!isLocale(locale)) notFound();
  const p = await publicPost(slug);
  if (!p || !t(p.title, locale)) notFound();
  const b = BLOG_UI[locale];
  const title = t(p.title, locale);
  const img = mediaUrl(p.image_path);
  const others = (await publicPosts(12)).filter((x) => x.id !== p.id && t(x.title, locale)).slice(0, 4);
  const fmt = new Intl.DateTimeFormat(locale === "tr" ? "tr-TR" : locale === "fr" ? "fr-FR" : "en-GB", { dateStyle: "long" });
  const site = siteUrl();
  const article = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: title,
    description: t(p.summary, locale),
    datePublished: p.publish_at,
    dateModified: p.updated_at,
    inLanguage: locale,
    image: img ? [img] : undefined,
    author: { "@type": "Organization", name: p.author || "MB Dental" },
    publisher: { "@type": "Organization", name: "MB Dental", logo: { "@type": "ImageObject", url: `${site}/logo.svg` } },
    mainEntityOfPage: `${site}/${locale}/blog/${p.slug}`,
  };
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: ldScript(article) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: ldScript(breadcrumbJsonLd([{ name: "MB Dental", path: `/${locale}` }, { name: b.nav, path: `/${locale}/blog` }, { name: title, path: `/${locale}/blog/${p.slug}` }])) }} />
      <SiteHeader locale={locale} altPath={`/blog/${p.slug}`} />
      <main>
        <article>
          <header className="bg-navy text-white">
            <div className="mx-auto max-w-3xl px-4 pb-12 pt-8 sm:px-6">
              <Link href={`/${locale}/blog`} className="text-sm font-semibold text-smile hover:underline">← {b.back}</Link>
              <p className="mt-6 text-sm font-semibold uppercase tracking-wider text-smile">{b.cats[p.category]} · {fmt.format(new Date(p.publish_at))}</p>
              <h1 className="display mt-3 text-4xl font-semibold leading-tight sm:text-5xl">{title}</h1>
              {t(p.summary, locale) && <p className="mt-4 text-xl text-white/80">{t(p.summary, locale)}</p>}
              {p.author && <p className="mt-4 text-sm text-white/60">{b.by}: {p.author}</p>}
            </div>
          </header>
          {img && (
            <div className="mx-auto -mt-2 max-w-4xl px-4 sm:px-6">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={img} alt={title} className="mt-8 aspect-[16/9] w-full rounded-3xl object-cover" />
            </div>
          )}
          <div className="mx-auto max-w-3xl px-4 py-12 text-lg sm:px-6">
            <RichText text={t(p.body, locale)} />
            {p.tags.length > 0 && <p className="mt-8 flex flex-wrap gap-2 text-sm">{p.tags.map((tag) => <span key={tag} className="rounded-full bg-white px-3 py-1 text-slate">#{tag}</span>)}</p>}
            <div className="mt-12 rounded-3xl bg-navy p-8 text-white">
              <p className="display text-2xl font-semibold">{b.cta}</p>
              <p className="mt-2 text-white/75">{b.ctaText}</p>
              <Link href={`/${locale}/vaka-gonder`} className="mt-5 inline-block rounded-full bg-smile px-6 py-3 font-semibold text-navy hover:bg-white">{b.ctaBtn}</Link>
            </div>
          </div>
        </article>
        {others.length > 0 && (
          <section className="mx-auto max-w-6xl px-4 pb-16 sm:px-6">
            <h2 className="display mb-4 text-2xl font-semibold text-navy">{b.related}</h2>
            <ul className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              {others.map((o) => (
                <li key={o.id}>
                  <Link href={`/${locale}/blog/${o.slug}`} className="block h-full rounded-2xl bg-white p-5 hover:shadow-md">
                    <p className="text-xs font-semibold uppercase tracking-wider text-smile-ink">{b.cats[o.category]}</p>
                    <p className="mt-1 font-semibold text-navy">{t(o.title, locale)}</p>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
      <SiteFooter locale={locale} />
    </>
  );
}
