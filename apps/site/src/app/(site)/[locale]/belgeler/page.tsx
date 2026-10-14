import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SiteFooter, SiteHeader } from "@/components/SiteChrome";
import { imgUrl, publicCredentials } from "@/lib/cms";
import { LOCALES, isLocale, t } from "@/lib/i18n";
import { CRED_UI } from "@/lib/pages-ui";
import { ldScript, siteUrl } from "@/lib/seo";

export const revalidate = 600;

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  return { title: `${CRED_UI[locale].title} — MB Dental`, description: CRED_UI[locale].lead, alternates: { canonical: `/${locale}/belgeler`, languages: Object.fromEntries(LOCALES.map((l) => [l, `/${l}/belgeler`])) } };
}

/** Belgeler, sertifikalar, üyelikler ve basında biz (güven sinyali; yapay zekâ ve Google için de) */
export default async function CredentialsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const u = CRED_UI[locale];
  const items = await publicCredentials();
  const site = siteUrl();
  const dt = (d: string | null) => (d ? new Date(d).toLocaleDateString(locale === "tr" ? "tr-TR" : locale === "fr" ? "fr-FR" : "en-GB") : null);
  const ld = { "@context": "https://schema.org", "@id": `${site}/#isletme`, "@type": "MedicalBusiness", name: "MB Dental",
    hasCredential: items.filter((i) => i.kind === "certificate").map((i) => ({ "@type": "EducationalOccupationalCredential", name: t(i.title, locale), recognizedBy: i.issuer ? { "@type": "Organization", name: i.issuer } : undefined, validUntil: i.valid_until ?? undefined })),
    award: items.filter((i) => i.kind === "award").map((i) => t(i.title, locale)), memberOf: items.filter((i) => i.kind === "membership").map((i) => ({ "@type": "Organization", name: i.issuer || t(i.title, locale) })) };
  return (
    <>
      <SiteHeader locale={locale} altPath="/belgeler" />
      <main>
        <section className="bg-navy text-white"><div className="mx-auto max-w-6xl px-4 pb-14 pt-8 sm:px-6"><h1 className="display text-5xl font-semibold tracking-tight sm:text-6xl">{u.title}</h1><p className="mt-4 max-w-2xl text-xl text-white/80">{u.lead}</p></div></section>
        <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
          {!items.length && <p className="text-slate">{u.none}</p>}
          {(["certificate", "membership", "award", "press"] as const).map((k) => {
            const xs = items.filter((i) => i.kind === k);
            if (!xs.length) return null;
            return (
              <section key={k} className="mb-10">
                <h2 className="display text-2xl font-semibold text-navy">{u.kinds[k]}</h2>
                <ul className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {xs.map((i) => {
                    const img = imgUrl(i.image_path);
                    return (
                      <li key={i.id} className="flex flex-col rounded-2xl border border-gypsum bg-white p-5">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        {img && <img src={img} alt="" className="mb-3 h-28 w-full rounded-xl object-contain" />}
                        <b className="text-lg text-ink">{t(i.title, locale)}</b>
                        <span className="text-sm text-slate">{[i.issuer, dt(i.issued_on)].filter(Boolean).join(" · ")}{i.valid_until ? ` · ${u.valid} ${dt(i.valid_until)}` : ""}</span>
                        {t(i.summary, locale) && <p className="mt-2 text-sm text-slate">{t(i.summary, locale)}</p>}
                        {i.url && <a href={i.url} target="_blank" rel="noreferrer" className="mt-auto pt-3 text-sm font-semibold text-smile-ink">{u.open} ↗</a>}
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>
      </main>
      <SiteFooter locale={locale} />
      {items.length > 0 && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: ldScript(ld) }} />}
    </>
  );
}
