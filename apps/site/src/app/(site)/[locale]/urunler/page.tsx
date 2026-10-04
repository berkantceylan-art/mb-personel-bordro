import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SiteFooter, SiteHeader } from "@/components/SiteChrome";
import { PRODUCT_CATEGORIES, mediaUrl, publicProducts } from "@/lib/cms";
import { LOCALES, PRODUCT_UI, isLocale, t } from "@/lib/i18n";

export const revalidate = 60;

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const ui = PRODUCT_UI[locale];
  return {
    title: `${ui.all} — MB Dental`,
    description: ui.lead,
    alternates: { canonical: `/${locale}/urunler`, languages: Object.fromEntries(LOCALES.map((l) => [l, `/${l}/urunler`])) },
  };
}

export default async function ProductsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const ui = PRODUCT_UI[locale];
  const products = await publicProducts();
  const groups = PRODUCT_CATEGORIES.map((c) => ({ c, items: products.filter((p) => p.category === c) })).filter((g) => g.items.length > 0);

  return (
    <>
      <SiteHeader locale={locale} altPath="/urunler" current="products" />
      <main>
        <section className="bg-navy text-white">
          <div className="mx-auto max-w-6xl px-4 pb-16 pt-8 sm:px-6">
            <h1 className="display text-5xl font-semibold sm:text-6xl">{ui.all}</h1>
            <p className="mt-4 max-w-2xl text-lg text-white/75">{ui.lead}</p>
            {groups.length > 1 && (
              <nav aria-label={ui.all} className="mt-8 flex flex-wrap gap-2">
                {groups.map(({ c }) => (
                  <a key={c} href={`#${c}`} className="rounded-full border border-white/25 px-4 py-2 text-sm hover:border-white">
                    {ui.categories[c]}
                  </a>
                ))}
              </nav>
            )}
          </div>
        </section>

        <div className="mx-auto grid max-w-6xl gap-16 px-4 py-16 sm:px-6">
          {groups.length === 0 && <p className="text-slate">—</p>}
          {groups.map(({ c, items }) => (
            <section key={c} id={c} aria-labelledby={`h-${c}`} className="scroll-mt-6">
              <h2 id={`h-${c}`} className="display border-b-2 border-navy pb-3 text-3xl font-semibold text-navy">
                {ui.categories[c]}
              </h2>
              <ul className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                {items.map((p) => {
                  const img = mediaUrl(p.image_path);
                  const name = t(p.name, locale);
                  return (
                    <li key={p.id}>
                      <Link href={`/${locale}/urunler/${p.slug}`} className="group flex h-full flex-col overflow-hidden rounded-2xl border border-gypsum bg-white hover:border-navy">
                        {img ? (
                          <div className="aspect-[4/3] bg-gypsum">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={img} alt="" className="h-full w-full object-cover" loading="lazy" />
                          </div>
                        ) : (
                          <div aria-hidden="true" className="h-1.5 bg-smile/70 transition-colors group-hover:bg-smile" />
                        )}
                        <div className={`flex flex-1 flex-col ${img ? "p-5" : "p-6"}`}>
                          <h3 className={`display font-semibold text-navy ${img ? "text-xl" : "text-2xl"}`}>{name}</h3>
                          <p className="mt-1 flex-1 text-sm text-slate">{t(p.summary, locale)}</p>
                          <span className="mt-4 text-sm font-semibold text-smile-ink group-hover:underline">{ui.more} →</span>
                        </div>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      </main>
      <SiteFooter locale={locale} />
    </>
  );
}
