import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SiteFooter, SiteHeader } from "@/components/SiteChrome";
import { mediaUrl, publicPosts } from "@/lib/cms";
import { BLOG_UI } from "@/lib/growth-ui";
import { LOCALES, isLocale, t, type Locale } from "@/lib/i18n";

export const dynamic = "force-dynamic";
type Params = Promise<{ locale: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const b = BLOG_UI[locale];
  return { title: `${b.title} — MB Dental`, description: b.lead, alternates: { canonical: `/${locale}/blog`, languages: Object.fromEntries(LOCALES.map((l) => [l, `/${l}/blog`])) } };
}

export default async function BlogIndex({ params, searchParams }: { params: Params; searchParams: Promise<{ kategori?: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const b = BLOG_UI[locale as Locale];
  const { kategori } = await searchParams;
  const all = (await publicPosts()).filter((p) => t(p.title, locale));
  const posts = kategori ? all.filter((p) => p.category === kategori) : all;
  const cats = [...new Set(all.map((p) => p.category))];
  const fmt = new Intl.DateTimeFormat(locale === "tr" ? "tr-TR" : locale === "fr" ? "fr-FR" : "en-GB", { dateStyle: "long" });
  return (
    <>
      <SiteHeader locale={locale} altPath="/blog" />
      <main>
        <section className="bg-navy text-white">
          <div className="mx-auto max-w-6xl px-4 pb-14 pt-8 sm:px-6">
            <h1 className="display text-5xl font-semibold tracking-tight sm:text-6xl">{b.title}</h1>
            <p className="mt-4 max-w-2xl text-xl text-white/80">{b.lead}</p>
          </div>
        </section>
        <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
          {cats.length > 1 && (
            <nav className="mb-8 flex flex-wrap gap-2 text-sm font-semibold">
              <Link href={`/${locale}/blog`} className={`rounded-full px-4 py-2 ${!kategori ? "bg-navy text-white" : "bg-white text-navy"}`}>{b.all}</Link>
              {cats.map((c) => (
                <Link key={c} href={`/${locale}/blog?kategori=${c}`} className={`rounded-full px-4 py-2 ${kategori === c ? "bg-navy text-white" : "bg-white text-navy"}`}>{b.cats[c]}</Link>
              ))}
            </nav>
          )}
          {posts.length === 0 ? (
            <p className="rounded-3xl bg-white p-10 text-center text-slate">{b.empty}</p>
          ) : (
            <ul className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {posts.map((p) => {
                const img = mediaUrl(p.image_path);
                return (
                  <li key={p.id}>
                    <Link href={`/${locale}/blog/${p.slug}`} className="group flex h-full flex-col overflow-hidden rounded-3xl bg-white transition-shadow hover:shadow-lg">
                      <div className="aspect-[16/9] bg-gypsum">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        {img && <img src={img} alt="" className="h-full w-full object-cover" loading="lazy" />}
                      </div>
                      <div className="flex flex-1 flex-col p-6">
                        <p className="text-xs font-semibold uppercase tracking-wider text-smile-ink">{b.cats[p.category]} · {fmt.format(new Date(p.publish_at))}</p>
                        <h2 className="display mt-2 text-xl font-semibold text-navy group-hover:underline">{t(p.title, locale)}</h2>
                        <p className="mt-2 line-clamp-3 text-slate">{t(p.summary, locale)}</p>
                        <span className="mt-auto pt-4 text-sm font-semibold text-navy">{b.read} →</span>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </main>
      <SiteFooter locale={locale} />
    </>
  );
}
