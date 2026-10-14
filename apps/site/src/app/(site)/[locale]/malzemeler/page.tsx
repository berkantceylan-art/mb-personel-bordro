import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SiteFooter, SiteHeader } from "@/components/SiteChrome";
import { publicMaterials } from "@/lib/cms";
import { LOCALES, isLocale, t } from "@/lib/i18n";
import { MAT_UI } from "@/lib/pages-ui";

export const revalidate = 300;

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  return { title: `${MAT_UI[locale].title} — MB Dental`, description: MAT_UI[locale].lead, alternates: { canonical: `/${locale}/malzemeler`, languages: Object.fromEntries(LOCALES.map((l) => [l, `/${l}/malzemeler`])) } };
}

export default async function MaterialsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const u = MAT_UI[locale];
  const mats = await publicMaterials();
  const cats = [...new Set(mats.map((m) => m.category))];
  return (
    <>
      <SiteHeader locale={locale} altPath="/malzemeler" />
      <main>
        <section className="bg-navy text-white"><div className="mx-auto max-w-6xl px-4 pb-14 pt-8 sm:px-6"><h1 className="display text-5xl font-semibold tracking-tight sm:text-6xl">{u.title}</h1><p className="mt-4 max-w-2xl text-xl text-white/80">{u.lead}</p></div></section>
        <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
          {cats.map((c) => (
            <section key={c} className="mb-10">
              <h2 className="display text-2xl font-semibold text-navy">{u.cats[c] ?? c}</h2>
              <ul className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {mats.filter((m) => m.category === c).map((m) => (
                  <li key={m.id}><Link href={`/${locale}/malzemeler/${m.slug}`} className="block h-full rounded-2xl border border-gypsum bg-white p-5 hover:border-navy"><b className="text-lg text-ink">{t(m.name, locale)}</b><span className="mt-1 block text-sm text-slate">{t(m.summary, locale)}</span></Link></li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </main>
      <SiteFooter locale={locale} />
    </>
  );
}
