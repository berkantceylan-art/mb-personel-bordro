import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ContactForm } from "@/components/ContactForm";
import { SiteFooter, SiteHeader } from "@/components/SiteChrome";
import { LOCALES, isLocale, t, type Locale } from "@/lib/i18n";
import { MapEmbed } from "@/components/MapEmbed";
import { HOURS_UI, groupedSchedule, hasSchedule, openState } from "@/lib/hours";
import { directionsUrl, getSettings, mapEmbedUrl, telHref } from "@/lib/settings";

export const dynamic = "force-dynamic";

const COPY: Record<Locale, { title: string; lead: string; direct: string; phone: string; email: string; whatsapp: string; address: string; hours: string; map: string }> = {
  tr: {
    title: "İletişim",
    lead: "Sorunuzu, fiyat talebinizi ya da iş birliği önerinizi yazın; en geç bir iş günü içinde dönüş yapıyoruz. Türkçe, İngilizce ve Fransızca konuşuyoruz.",
    direct: "Doğrudan ulaşın",
    phone: "Telefon",
    email: "E-posta",
    whatsapp: "WhatsApp",
    address: "Laboratuvar",
    hours: "Çalışma saatleri",
    map: "Haritada aç",
  },
  en: {
    title: "Contact",
    lead: "Send us your question, price request or partnership proposal; we reply within one business day. We speak Turkish, English and French.",
    direct: "Reach us directly",
    phone: "Phone",
    email: "Email",
    whatsapp: "WhatsApp",
    address: "Laboratory",
    hours: "Opening hours",
    map: "Open in maps",
  },
  fr: {
    title: "Contact",
    lead: "Écrivez-nous pour une question, un devis ou un partenariat ; nous répondons sous un jour ouvré. Nous parlons turc, anglais et français.",
    direct: "Nous joindre directement",
    phone: "Téléphone",
    email: "E-mail",
    whatsapp: "WhatsApp",
    address: "Laboratoire",
    hours: "Horaires",
    map: "Ouvrir le plan",
  },
};

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  return {
    title: `${COPY[locale].title} — MB Dental`,
    description: COPY[locale].lead,
    alternates: { canonical: `/${locale}/iletisim`, languages: Object.fromEntries(LOCALES.map((l) => [l, `/${l}/iletisim`])) },
  };
}

export default async function ContactPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ konu?: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const { konu } = await searchParams;
  const c = COPY[locale];
  const st = await getSettings();
  const hours = t(st.hours, locale);
  const embed = mapEmbedUrl(st, locale);
  const directions = directionsUrl(st);
  const now = openState(st.schedule, locale);
  const topic = konu === "fiyat" ? "price" : konu === "is-birligi" ? "partner" : konu === "vaka" ? "case" : konu === "kurye" ? "pickup" : "general";

  return (
    <>
      <SiteHeader locale={locale} altPath="/iletisim" current="contact" />
      <main>
        <section className="bg-navy text-white">
          <div className="mx-auto max-w-6xl px-4 pb-14 pt-8 sm:px-6">
            <h1 className="display text-5xl font-semibold sm:text-6xl">{c.title}</h1>
            <p className="mt-4 max-w-2xl text-lg text-white/75">{c.lead}</p>
          </div>
        </section>
        <div className="mx-auto flex max-w-6xl flex-wrap items-start gap-12 px-4 py-14 sm:px-6">
          <div className="min-w-0 flex-[999_1_32rem] rounded-3xl border border-gypsum bg-white p-6 sm:p-8">
            <ContactForm locale={locale} topic={topic} page={`/${locale}/iletisim`} />
          </div>
          <aside className="grid min-w-0 flex-[1_1_18rem] gap-6">
            <div className="rounded-3xl bg-navy p-7 text-white">
              <h2 className="display text-xl font-semibold">{c.direct}</h2>
              <dl className="mt-4 grid gap-3 text-[15px]">
                <div>
                  <dt className="text-sm text-white/55">{c.phone}</dt>
                  <dd>
                    <a href={telHref(st.phone)} className="font-semibold hover:text-smile">
                      {st.phone}
                    </a>
                  </dd>
                </div>
                <div>
                  <dt className="text-sm text-white/55">{c.email}</dt>
                  <dd>
                    <a href={`mailto:${st.email}`} className="font-semibold hover:text-smile">
                      {st.email}
                    </a>
                  </dd>
                </div>
                {st.whatsapp && (
                  <div>
                    <dt className="text-sm text-white/55">{c.whatsapp}</dt>
                    <dd>
                      <a href={`https://wa.me/${st.whatsapp}`} target="_blank" rel="noreferrer" className="font-semibold hover:text-smile">
                        +{st.whatsapp}
                      </a>
                    </dd>
                  </div>
                )}
                {(hasSchedule(st.schedule) || hours) && (
                  <div>
                    <dt className="text-sm text-white/55">{c.hours}</dt>
                    {now && (
                      <dd className="my-2 flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-2xl bg-white/10 px-3 py-1.5 text-xs">
                        <span aria-hidden="true" className={`h-2 w-2 rounded-full ${now.open ? "bg-[#3ddc84]" : "bg-white/40"}`} />
                        <span className="font-semibold">{now.open ? HOURS_UI[locale].open : HOURS_UI[locale].closed}</span>
                        {now.label && <span className="text-white/65">· {now.label}</span>}
                      </dd>
                    )}
                    {hasSchedule(st.schedule) &&
                      groupedSchedule(st.schedule, locale).map((g) => (
                        <dd key={g.days} className="flex justify-between gap-4 text-sm">
                          <span>{g.days}</span>
                          <span className="tabular-nums">{g.hours}</span>
                        </dd>
                      ))}
                    {hours && <dd className="mt-1 whitespace-pre-line text-sm text-white/70">{hours}</dd>}
                    {hasSchedule(st.schedule) && <dd className="mt-1 text-xs text-white/45">({HOURS_UI[locale].tz})</dd>}
                  </div>
                )}
              </dl>
            </div>
            <div className="rounded-3xl border border-gypsum bg-white p-7">
              <h2 className="display text-xl font-semibold text-navy">{c.address}</h2>
              <address className="mt-3 not-italic text-slate">
                {[st.address1, st.address2].filter(Boolean).map((l) => (
                  <span key={l} className="block">
                    {l}
                  </span>
                ))}
              </address>
              {st.map_url && (
                <a href={st.map_url} target="_blank" rel="noreferrer" className="mt-4 inline-block text-sm font-semibold text-smile-ink hover:underline">
                  {c.map} ↗
                </a>
              )}
            </div>
          </aside>
        </div>
        {embed && (
          <section aria-label={c.address} className="mx-auto max-w-6xl px-4 pb-16 sm:px-6">
            <MapEmbed src={embed} directions={directions} locale={locale} />
          </section>
        )}
      </main>
      <SiteFooter locale={locale} />
    </>
  );
}
