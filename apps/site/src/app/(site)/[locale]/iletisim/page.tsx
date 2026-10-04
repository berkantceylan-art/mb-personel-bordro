import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ContactForm } from "@/components/ContactForm";
import { SiteFooter, SiteHeader } from "@/components/SiteChrome";
import { LOCALES, isLocale, t, type Locale } from "@/lib/i18n";
import { getSettings, telHref } from "@/lib/settings";

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
  const topic = konu === "fiyat" ? "price" : konu === "is-birligi" ? "partner" : konu === "vaka" ? "case" : "general";

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
                {hours && (
                  <div>
                    <dt className="text-sm text-white/55">{c.hours}</dt>
                    <dd className="whitespace-pre-line">{hours}</dd>
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
              <a
                href={st.map_url || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`MB Dental ${st.address1} ${st.address2}`)}`}
                target="_blank"
                rel="noreferrer"
                className="mt-4 inline-block text-sm font-semibold text-smile-ink hover:underline"
              >
                {c.map} ↗
              </a>
            </div>
          </aside>
        </div>
      </main>
      <SiteFooter locale={locale} />
    </>
  );
}
