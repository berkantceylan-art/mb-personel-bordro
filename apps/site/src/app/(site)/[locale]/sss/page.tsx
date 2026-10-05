import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { RichText } from "@/components/RichText";
import { SiteFooter, SiteHeader } from "@/components/SiteChrome";
import { FAQ_CATEGORIES, FAQ_CATEGORY_LABELS, publicFaqs } from "@/lib/cms";
import { LOCALES, isLocale, t, type Locale } from "@/lib/i18n";

export const revalidate = 300;

const COPY: Record<Locale, { title: string; lead: string; more: string; moreText: string; contact: string; home: string }> = {
  tr: {
    title: "Sıkça sorulan sorular",
    lead: "Vaka gönderme, dijital dosyalar, teslimat ve hekim portalı hakkında en çok sorulanlar.",
    more: "Cevabını bulamadınız mı?",
    moreText: "Sağ alttaki destek düğmesinden canlı olarak ya da WhatsApp ile yazabilirsiniz.",
    contact: "Bize yazın",
    home: "Anasayfa",
  },
  en: {
    title: "Frequently asked questions",
    lead: "The most common questions about sending cases, digital files, delivery and the doctor portal.",
    more: "Didn't find your answer?",
    moreText: "Use the support button at the bottom right to chat live or message us on WhatsApp.",
    contact: "Write to us",
    home: "Home",
  },
  fr: {
    title: "Questions fréquentes",
    lead: "Les questions les plus courantes sur l’envoi de cas, les fichiers numériques, la livraison et le portail praticien.",
    more: "Vous n’avez pas trouvé la réponse ?",
    moreText: "Utilisez le bouton d’aide en bas à droite pour discuter en direct ou nous écrire sur WhatsApp.",
    contact: "Écrivez-nous",
    home: "Accueil",
  },
};

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const c = COPY[locale];
  return {
    title: `${c.title} — MB Dental`,
    description: c.lead,
    alternates: { canonical: `/${locale}/sss`, languages: Object.fromEntries(LOCALES.map((l) => [l, `/${l}/sss`])) },
    openGraph: { title: c.title, description: c.lead, siteName: "MB Dental", locale },
  };
}

/** Düz metin: RichText işaretlerini (##, >, -) temizler */
const plain = (s: string) => s.replace(/^(## |> |- )/gm, "").trim();

export default async function FaqPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const c = COPY[locale];
  const faqs = await publicFaqs();
  const groups = FAQ_CATEGORIES.map((g) => ({ g, items: faqs.filter((f) => f.category === g) })).filter((x) => x.items.length);
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? "https://mbdentaire.com";

  const jsonLd = [
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      inLanguage: locale,
      mainEntity: faqs.map((f) => ({
        "@type": "Question",
        name: t(f.question, locale),
        acceptedAnswer: { "@type": "Answer", text: plain(t(f.answer, locale)) },
      })),
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: c.home, item: `${site}/${locale}` },
        { "@type": "ListItem", position: 2, name: c.title, item: `${site}/${locale}/sss` },
      ],
    },
  ];

  return (
    <>
      <SiteHeader locale={locale} altPath="/sss" />
      <main>
        <section className="bg-navy text-white">
          <div className="mx-auto max-w-6xl px-4 pb-14 pt-8 sm:px-6">
            <h1 className="display text-5xl font-semibold sm:text-6xl">{c.title}</h1>
            <p className="mt-4 max-w-2xl text-lg text-white/75">{c.lead}</p>
            {groups.length > 1 && (
              <nav aria-label={c.title} className="mt-8 flex flex-wrap gap-2 text-sm">
                {groups.map(({ g }) => (
                  <a key={g} href={`#${g}`} className="rounded-full border border-white/25 px-4 py-1.5 hover:border-white">
                    {FAQ_CATEGORY_LABELS[g][locale]}
                  </a>
                ))}
              </nav>
            )}
          </div>
        </section>
        <div className="mx-auto grid max-w-4xl gap-12 px-4 py-14 sm:px-6">
          {groups.map(({ g, items }) => (
            <section key={g} id={g} aria-labelledby={`${g}-baslik`} className="reveal scroll-mt-24">
              <h2 id={`${g}-baslik`} className="display text-2xl font-semibold text-navy">
                {FAQ_CATEGORY_LABELS[g][locale]}
              </h2>
              <div className="mt-4 divide-y divide-gypsum overflow-hidden rounded-3xl border border-gypsum bg-white">
                {items.map((f) => (
                  <details key={f.id} className="faq group">
                    <summary className="flex cursor-pointer list-none items-center gap-4 px-6 py-5 text-lg font-semibold text-ink hover:bg-porcelain">
                      <span className="flex-1">{t(f.question, locale)}</span>
                      <span aria-hidden="true" className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-porcelain text-navy transition-transform group-open:rotate-45">
                        +
                      </span>
                    </summary>
                    <div className="px-6 pb-6 text-slate">
                      <RichText text={t(f.answer, locale)} />
                    </div>
                  </details>
                ))}
              </div>
            </section>
          ))}
          <div className="rounded-3xl bg-navy p-8 text-white sm:flex sm:items-center sm:gap-6">
            <div className="flex-1">
              <h2 className="display text-2xl font-semibold">{c.more}</h2>
              <p className="mt-2 text-white/75">{c.moreText}</p>
            </div>
            <Link href={`/${locale}/iletisim`} className="mt-5 inline-block rounded-full bg-smile px-6 py-3 font-semibold text-navy hover:bg-white sm:mt-0">
              {c.contact}
            </Link>
          </div>
        </div>
      </main>
      <SiteFooter locale={locale} />
      {faqs.length > 0 && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />}
    </>
  );
}
