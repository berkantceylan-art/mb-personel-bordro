import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { RichText } from "@/components/RichText";
import { SiteFooter, SiteHeader } from "@/components/SiteChrome";
import { mediaUrl, publicPage, publicPages } from "@/lib/cms";
import { LOCALES, PAGE_UI, isLocale, t } from "@/lib/i18n";

export const revalidate = 60;

type Params = Promise<{ locale: string; slug: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { locale, slug } = await params;
  if (!isLocale(locale)) return {};
  const p = await publicPage(slug);
  if (!p) return {};
  const title = t(p.seo_title, locale) || `${t(p.title, locale)} — MB Dental`;
  const description = t(p.seo_description, locale) || t(p.summary, locale);
  const img = mediaUrl(p.image_path);
  return {
    title,
    description,
    alternates: { canonical: `/${locale}/${slug}`, languages: Object.fromEntries(LOCALES.map((l) => [l, `/${l}/${slug}`])) },
    openGraph: { title, description, siteName: "MB Dental", locale, images: img ? [img] : undefined },
  };
}

export default async function CorporatePage({ params }: { params: Params }) {
  const { locale, slug } = await params;
  if (!isLocale(locale)) notFound();
  const p = await publicPage(slug);
  if (!p) notFound();
  const ui = PAGE_UI[locale];
  const title = t(p.title, locale);
  const summary = t(p.summary, locale);
  const body = t(p.body, locale);
  const img = mediaUrl(p.image_path);
  const gallery = p.gallery.map((g) => mediaUrl(g)).filter((u): u is string => !!u);
  const siblings = (await publicPages()).filter((x) => x.group === p.group);

  return (
    <>
      <SiteHeader locale={locale} altPath={`/${p.slug}`} current={p.slug === "hakkimizda" ? "about" : undefined} />
      <main>
        <section className="bg-navy text-white">
          <div className={`mx-auto grid max-w-6xl items-center gap-12 px-4 pb-16 pt-8 sm:px-6 ${img ? "lg:grid-cols-[1fr_1fr]" : ""}`}>
            <div className="min-w-0">
              <p className="text-sm font-semibold uppercase tracking-wider text-smile">{ui.groups[p.group]}</p>
              <h1 className="display mt-4 text-5xl font-semibold leading-[1.02] tracking-tight sm:text-6xl">{title}</h1>
              {summary && <p className="mt-5 max-w-xl text-xl leading-relaxed text-white/80">{summary}</p>}
            </div>
            {img && (
              <div className="aspect-[4/3] overflow-hidden rounded-[1.75rem] bg-navy-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={img} alt={title} className="h-full w-full object-cover" />
              </div>
            )}
          </div>
        </section>

        <div className="mx-auto flex max-w-6xl flex-wrap items-start gap-12 px-4 py-16 sm:px-6 lg:gap-16">
          <article className="min-w-0 flex-[999_1_34rem] text-lg">
            {body && <RichText text={body} />}
            {gallery.length > 0 && (
              <ul className="mt-10 grid grid-cols-2 gap-4 md:grid-cols-3">
                {gallery.map((g, i) => (
                  <li key={g} className="aspect-[4/3] overflow-hidden rounded-2xl bg-gypsum">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={g} alt={`${title} ${i + 1}`} className="h-full w-full object-cover" loading="lazy" />
                  </li>
                ))}
              </ul>
            )}
          </article>
          <aside className="grid min-w-0 flex-[1_1_18rem] gap-5 lg:sticky lg:top-6">
            {siblings.length > 1 && (
              <nav aria-label={ui.related} className="rounded-3xl border border-gypsum bg-white p-6">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-slate">{ui.related}</h2>
                <ul className="mt-3 grid gap-1">
                  {siblings.map((s) => (
                    <li key={s.id}>
                      <Link
                        href={`/${locale}/${s.slug}`}
                        aria-current={s.id === p.id ? "page" : undefined}
                        className="block rounded-lg px-3 py-2 font-semibold text-ink hover:bg-porcelain aria-[current=page]:bg-navy aria-[current=page]:text-white"
                      >
                        {t(s.title, locale)}
                      </Link>
                    </li>
                  ))}
                </ul>
              </nav>
            )}
            <div className="rounded-3xl bg-navy p-7 text-white">
              <h2 className="display text-xl font-semibold">{ui.cta}</h2>
              <p className="mt-2 text-[15px] leading-relaxed text-white/75">{ui.ctaText}</p>
              <div className="mt-5 flex flex-wrap gap-2">
                <Link href={`/${locale}/vaka-gonder`} className="rounded-full bg-smile px-5 py-3 font-semibold text-navy hover:bg-white">
                  {ui.send}
                </Link>
                <Link href={`/${locale}/iletisim`} className="rounded-full border border-white/30 px-5 py-3 font-semibold hover:border-white">
                  {ui.contact}
                </Link>
              </div>
            </div>
          </aside>
        </div>
      </main>
      <SiteFooter locale={locale} />
    </>
  );
}
