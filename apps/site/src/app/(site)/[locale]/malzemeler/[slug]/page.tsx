import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { RichText } from "@/components/RichText";
import { SiteFooter, SiteHeader } from "@/components/SiteChrome";
import { imgUrl, publicMaterials, publicProducts } from "@/lib/cms";
import { LOCALES, isLocale, t } from "@/lib/i18n";
import { MAT_UI } from "@/lib/pages-ui";
import { breadcrumbJsonLd, ldScript, siteUrl } from "@/lib/seo";

export const revalidate = 300;
type Params = Promise<{ locale: string; slug: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { locale, slug } = await params;
  if (!isLocale(locale)) return {};
  const m = (await publicMaterials()).find((x) => x.slug === slug);
  if (!m) return {};
  return { title: `${t(m.name, locale)} — ${MAT_UI[locale].title}`, description: t(m.summary, locale), alternates: { canonical: `/${locale}/malzemeler/${slug}`, languages: Object.fromEntries(LOCALES.map((l) => [l, `/${l}/malzemeler/${slug}`])) } };
}

/** Malzeme sayfası: tanım, kullanım alanları, teknik özellikler, ilgili ürünler */
export default async function MaterialPage({ params }: { params: Params }) {
  const { locale, slug } = await params;
  if (!isLocale(locale)) notFound();
  const [mats, products] = await Promise.all([publicMaterials(), publicProducts()]);
  const m = mats.find((x) => x.slug === slug);
  if (!m) notFound();
  const u = MAT_UI[locale];
  const name = t(m.name, locale);
  const img = imgUrl(m.image_path);
  const rel = products.filter((p) => m.product_slugs.includes(p.slug));
  const ind = t(m.indications, locale).split("\n").map((x) => x.trim()).filter(Boolean);
  const site = siteUrl();
  const ld = { "@context": "https://schema.org", "@type": "TechArticle", headline: name, description: t(m.summary, locale), about: { "@type": "Thing", name }, author: { "@id": `${site}/#isletme` }, publisher: { "@id": `${site}/#isletme` }, dateModified: m.updated_at, image: img ?? undefined, url: `${site}/${locale}/malzemeler/${slug}` };
  const crumbs = breadcrumbJsonLd([{ name: "MB Dental", path: `/${locale}` }, { name: u.title, path: `/${locale}/malzemeler` }, { name, path: `/${locale}/malzemeler/${slug}` }]);
  return (
    <>
      <SiteHeader locale={locale} altPath={`/malzemeler/${slug}`} />
      <main>
        <section className="bg-navy text-white"><div className="mx-auto max-w-5xl px-4 pb-14 pt-8 sm:px-6"><nav className="text-sm text-white/65"><Link href={`/${locale}/malzemeler`} className="hover:text-white">{u.all}</Link> / {u.cats[m.category] ?? m.category}</nav><h1 className="display mt-4 text-5xl font-semibold tracking-tight">{name}</h1><p className="mt-4 max-w-2xl text-xl text-white/80">{t(m.summary, locale)}</p></div></section>
        <div className="mx-auto grid max-w-5xl gap-10 px-4 py-12 sm:px-6 lg:grid-cols-[1.4fr_1fr]">
          <article className="text-lg">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {img && <img src={img} alt={name} className="mb-6 w-full rounded-2xl object-cover" />}
            {t(m.body, locale) ? <RichText text={t(m.body, locale)} /> : null}
            {ind.length > 0 && <><h2 className="display mt-8 text-2xl font-semibold text-navy">{u.indications}</h2><ul className="mt-3 grid gap-2">{ind.map((x) => <li key={x} className="flex gap-3"><span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-smile" />{x}</li>)}</ul></>}
          </article>
          <aside className="grid content-start gap-5">
            {m.props.length > 0 && (
              <div className="rounded-3xl border border-gypsum bg-white p-6"><h2 className="display text-xl font-semibold text-navy">{u.props}</h2>
                <dl className="mt-3 grid gap-2 text-sm">{m.props.map((p, i) => <div key={i} className="flex justify-between gap-4 border-b border-porcelain pb-1.5"><dt className="text-slate">{t(p.k, locale)}</dt><dd className="font-semibold">{p.v}</dd></div>)}</dl>
              </div>
            )}
            {m.brands && <div className="rounded-3xl border border-gypsum bg-white p-6 text-sm"><h2 className="font-semibold text-navy">{u.brands}</h2><p className="mt-1 text-slate">{m.brands}</p></div>}
            {rel.length > 0 && <div className="rounded-3xl border border-gypsum bg-white p-6"><h2 className="display text-xl font-semibold text-navy">{u.products}</h2><ul className="mt-3 grid gap-1.5">{rel.map((p) => <li key={p.id}><Link href={`/${locale}/urunler/${p.slug}`} className="hover:underline">{t(p.name, locale)}</Link></li>)}</ul></div>}
            <Link href={`/${locale}/vaka-gonder`} className="rounded-3xl bg-navy p-6 text-center font-semibold text-white hover:bg-blue">{u.send} →</Link>
          </aside>
        </div>
      </main>
      <SiteFooter locale={locale} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: ldScript([ld, crumbs]) }} />
    </>
  );
}
