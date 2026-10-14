import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { RichText } from "@/components/RichText";
import { SiteFooter, SiteHeader } from "@/components/SiteChrome";
import { imgUrl, publicEvents } from "@/lib/cms";
import { LOCALES, isLocale, t } from "@/lib/i18n";
import { EVT_UI, when } from "@/lib/pages-ui";
import { ldScript, siteUrl } from "@/lib/seo";
import { RegisterForm } from "./RegisterForm";

export const revalidate = 120;
type Params = Promise<{ locale: string; slug: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { locale, slug } = await params;
  if (!isLocale(locale)) return {};
  const e = (await publicEvents()).find((x) => x.slug === slug);
  if (!e) return {};
  return { title: `${t(e.title, locale)} — MB Dental`, description: t(e.summary, locale), alternates: { canonical: `/${locale}/egitim/${slug}`, languages: Object.fromEntries(LOCALES.map((l) => [l, `/${l}/egitim/${slug}`])) } };
}

export default async function EventPage({ params }: { params: Params }) {
  const { locale, slug } = await params;
  if (!isLocale(locale)) notFound();
  const e = (await publicEvents()).find((x) => x.slug === slug);
  if (!e) notFound();
  const u = EVT_UI[locale];
  const past = new Date(e.starts_at).getTime() < Date.now();
  const img = imgUrl(e.image_path);
  const site = siteUrl();
  const end = new Date(new Date(e.starts_at).getTime() + e.duration_min * 60000).toISOString();
  const ld = {
    "@context": "https://schema.org", "@type": "EducationEvent", name: t(e.title, locale), description: t(e.summary, locale), startDate: e.starts_at, endDate: end,
    eventAttendanceMode: e.mode === "online" ? "https://schema.org/OnlineEventAttendanceMode" : e.mode === "onsite" ? "https://schema.org/OfflineEventAttendanceMode" : "https://schema.org/MixedEventAttendanceMode",
    eventStatus: "https://schema.org/EventScheduled", location: e.mode === "online" ? { "@type": "VirtualLocation", url: `${site}/${locale}/egitim/${slug}` } : { "@type": "Place", name: e.location ?? "MB Dental", address: e.location ?? "İzmir" },
    organizer: { "@id": `${site}/#isletme` }, performer: e.speaker ? { "@type": "Person", name: e.speaker } : undefined, image: img ?? undefined,
    offers: { "@type": "Offer", price: 0, priceCurrency: "TRY", availability: "https://schema.org/InStock", url: `${site}/${locale}/egitim/${slug}` }, isAccessibleForFree: true,
  };
  return (
    <>
      <SiteHeader locale={locale} altPath={`/egitim/${slug}`} />
      <main>
        <section className="bg-navy text-white"><div className="mx-auto max-w-5xl px-4 pb-14 pt-8 sm:px-6"><nav className="text-sm text-white/65"><Link href={`/${locale}/egitim`} className="hover:text-white">{u.title}</Link></nav><h1 className="display mt-4 text-4xl font-semibold sm:text-5xl">{t(e.title, locale)}</h1><p className="mt-4 text-lg text-white/80">{when(e.starts_at, locale)} · {u.mode[e.mode]} · {e.duration_min} {u.minutes}{e.location ? ` · ${e.location}` : ""}</p>{e.speaker && <p className="mt-1 text-white/70">{u.speaker}: {e.speaker}</p>}</div></section>
        <div className="mx-auto grid max-w-5xl gap-10 px-4 py-12 sm:px-6 lg:grid-cols-[1.4fr_1fr]">
          <article className="text-lg">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {img && <img src={img} alt="" className="mb-6 w-full rounded-2xl object-cover" />}
            <p className="text-slate">{t(e.summary, locale)}</p>
            {t(e.body, locale) && <div className="mt-6"><RichText text={t(e.body, locale)} /></div>}
          </article>
          <aside className="rounded-3xl border border-gypsum bg-white p-6">
            <h2 className="display mb-4 text-xl font-semibold text-navy">{u.register}</h2>
            {past ? <p className="text-slate">{u.passed}</p> : <RegisterForm eventId={e.id} locale={locale} />}
          </aside>
        </div>
      </main>
      <SiteFooter locale={locale} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: ldScript(ld) }} />
    </>
  );
}
