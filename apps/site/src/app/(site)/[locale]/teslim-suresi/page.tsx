import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SiteFooter, SiteHeader } from "@/components/SiteChrome";
import { publicProducts } from "@/lib/cms";
import { LEAD_UI } from "@/lib/growth-ui";
import { LOCALES, isLocale, t } from "@/lib/i18n";
import { getSettings } from "@/lib/settings";
import { LeadCalculator } from "./Calculator";

export const revalidate = 600;
type Params = Promise<{ locale: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const u = LEAD_UI[locale];
  return { title: `${u.title} — MB Dental`, description: u.lead, alternates: { canonical: `/${locale}/teslim-suresi`, languages: Object.fromEntries(LOCALES.map((l) => [l, `/${l}/teslim-suresi`])) } };
}

export default async function LeadTimePage({ params }: { params: Params }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const u = LEAD_UI[locale];
  const [products, st] = await Promise.all([publicProducts(), getSettings()]);
  const list = products.filter((p) => p.lead_days != null).map((p) => ({ slug: p.slug, name: t(p.name, locale), days: Number(p.lead_days) }));
  // Haftalık takvimde kapalı günler (schedule: Pazartesi→Pazar); takvim yoksa Pazar kapalı
  const closed = st.schedule?.some((x) => x) ? st.schedule.map((x, i) => (x ? -1 : (i + 1) % 7)).filter((d) => d >= 0) : [0];
  return (
    <>
      <SiteHeader locale={locale} altPath="/teslim-suresi" />
      <main>
        <section className="bg-navy text-white">
          <div className="mx-auto max-w-6xl px-4 pb-14 pt-8 sm:px-6">
            <h1 className="display text-5xl font-semibold tracking-tight sm:text-6xl">{u.title}</h1>
            <p className="mt-4 max-w-2xl text-xl text-white/80">{u.lead}</p>
          </div>
        </section>
        <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
          <LeadCalculator locale={locale} products={list} closedDays={closed} />
        </div>
      </main>
      <SiteFooter locale={locale} />
    </>
  );
}
