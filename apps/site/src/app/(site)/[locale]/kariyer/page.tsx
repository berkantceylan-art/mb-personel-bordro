import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { RichText } from "@/components/RichText";
import { SiteFooter, SiteHeader } from "@/components/SiteChrome";
import { publicJobPostings } from "@/lib/cms";
import { CAREER_UI } from "@/lib/growth-ui";
import { LOCALES, isLocale } from "@/lib/i18n";

export const revalidate = 600;
type Params = Promise<{ locale: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const c = CAREER_UI[locale];
  return { title: `${c.title} — MB Dental`, description: c.lead, alternates: { canonical: `/${locale}/kariyer`, languages: Object.fromEntries(LOCALES.map((l) => [l, `/${l}/kariyer`])) } };
}

/** Açık ilanlar ERP işe alım modülünden gelir; başvuru ERP'nin başvuru formuna gider */
export default async function CareersPage({ params }: { params: Params }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const c = CAREER_UI[locale];
  const jobs = await publicJobPostings();
  const erp = (process.env.NEXT_PUBLIC_ERP_URL ?? "").replace(/\/+$/, "");
  const fmt = new Intl.DateTimeFormat(locale === "tr" ? "tr-TR" : locale === "fr" ? "fr-FR" : "en-GB", { dateStyle: "medium" });
  return (
    <>
      <SiteHeader locale={locale} altPath="/kariyer" />
      <main>
        <section className="bg-navy text-white">
          <div className="mx-auto max-w-6xl px-4 pb-14 pt-8 sm:px-6">
            <h1 className="display text-5xl font-semibold tracking-tight sm:text-6xl">{c.title}</h1>
            <p className="mt-4 max-w-2xl text-xl text-white/80">{c.lead}</p>
          </div>
        </section>
        <div className="mx-auto grid max-w-4xl gap-5 px-4 py-12 sm:px-6">
          {jobs.length === 0 && <p className="rounded-3xl bg-white p-8 text-slate">{c.empty}</p>}
          {jobs.map((j) => (
            <article key={j.slug} className="rounded-3xl bg-white p-7">
              <h2 className="display text-2xl font-semibold text-navy">{j.title}</h2>
              <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm text-slate">
                {j.department && <div><dt className="inline font-semibold">{c.dept}: </dt><dd className="inline">{j.department}</dd></div>}
                <div><dt className="inline font-semibold">{c.type}: </dt><dd className="inline">{j.employment_type}</dd></div>
                {j.experience && <div><dt className="inline font-semibold">{c.exp}: </dt><dd className="inline">{j.experience}</dd></div>}
                {j.location && <div><dt className="inline font-semibold">{c.loc}: </dt><dd className="inline">{j.location}</dd></div>}
                {j.closes_on && <div><dt className="inline font-semibold">{c.closes}: </dt><dd className="inline">{fmt.format(new Date(`${j.closes_on}T12:00:00`))}</dd></div>}
              </dl>
              {j.description && <div className="mt-4"><RichText text={j.description} /></div>}
              {j.requirements && <div className="mt-3 text-slate"><RichText text={j.requirements} /></div>}
              {erp && <a href={`${erp}/kariyer?ilan=${encodeURIComponent(j.slug)}`} className="mt-5 inline-block rounded-full bg-navy px-6 py-3 font-semibold text-white hover:bg-blue">{c.apply}</a>}
            </article>
          ))}
          {erp && (
            <div className="rounded-3xl border border-dashed border-gypsum bg-white p-7">
              <h2 className="display text-xl font-semibold text-navy">{c.general}</h2>
              <p className="mt-1 text-slate">{c.generalText}</p>
              <a href={`${erp}/kariyer`} className="mt-4 inline-block rounded-full border border-navy px-5 py-2.5 font-semibold text-navy hover:bg-navy hover:text-white">{c.apply}</a>
            </div>
          )}
        </div>
      </main>
      <SiteFooter locale={locale} />
    </>
  );
}
