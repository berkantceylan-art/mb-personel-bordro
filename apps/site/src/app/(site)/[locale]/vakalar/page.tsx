import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CaseCard } from "@/components/CaseCard";
import { SiteFooter, SiteHeader } from "@/components/SiteChrome";
import { publicCases, publicProducts } from "@/lib/cms";
import { CASE_UI, LOCALES, isLocale, t } from "@/lib/i18n";

export const revalidate = 60;

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  return {
    title: `${CASE_UI[locale].title} — MB Dental`,
    description: CASE_UI[locale].lead,
    alternates: { canonical: `/${locale}/vakalar`, languages: Object.fromEntries(LOCALES.map((l) => [l, `/${l}/vakalar`])) },
  };
}

export default async function CasesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const ui = CASE_UI[locale];
  const [cases, products] = await Promise.all([publicCases(), publicProducts()]);
  const names = Object.fromEntries(products.map((p) => [p.slug, t(p.name, locale)]));
  return (
    <>
      <SiteHeader locale={locale} altPath="/vakalar" />
      <main>
        <section className="bg-navy text-white">
          <div className="mx-auto max-w-6xl px-4 pb-14 pt-8 sm:px-6">
            <h1 className="display text-5xl font-semibold sm:text-6xl">{ui.title}</h1>
            <p className="mt-4 max-w-2xl text-lg text-white/75">{ui.lead}</p>
          </div>
        </section>
        <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
          {cases.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-gypsum bg-white p-10 text-center text-slate">{ui.empty}</p>
          ) : (
            <ul className="grid gap-10 sm:grid-cols-2 lg:grid-cols-3">
              {cases.map((c) => (
                <li key={c.id}>
                  <CaseCard c={c} locale={locale} productName={c.product_slug ? names[c.product_slug] : undefined} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </main>
      <SiteFooter locale={locale} />
    </>
  );
}
