import Link from "next/link";
import { notFound } from "next/navigation";
import { SiteFooter, SiteHeader } from "@/components/SiteChrome";
import { publicProduct } from "@/lib/cms";
import { ContactForm } from "@/components/ContactForm";
import { isLocale, t, type Locale } from "@/lib/i18n";
import { getSettings, telHref } from "@/lib/settings";

export const dynamic = "force-dynamic";

const COPY: Record<Locale, { title: string; tooth: string; lead: string; mail: string; call: string; back: string; subject: string; files: string }> = {
  tr: {
    title: "Vaka gönder",
    tooth: "Seçilen diş",
    lead: "Vakanızı kısaca yazın; aynı gün dönüp teslim tarihini bildirelim. Dosya yükleme hekim portalıyla birlikte açılacak.",
    files: "Tarama dosyalarınızı (STL, ZIP) şimdilik e-postayla gönderebilirsiniz:",
    mail: "E-postayla gönder",
    call: "Ara",
    back: "Anasayfa",
    subject: "Yeni vaka",
  },
  en: {
    title: "Send a case",
    tooth: "Selected tooth",
    lead: "Describe your case briefly; we get back to you the same day with a delivery date. File upload will open with the dentist portal.",
    files: "For now you can email your scan files (STL, ZIP):",
    mail: "Send by email",
    call: "Call",
    back: "Home",
    subject: "New case",
  },
  fr: {
    title: "Envoyer un cas",
    tooth: "Dent sélectionnée",
    lead: "Décrivez brièvement votre cas ; nous revenons vers vous le jour même avec une date de livraison. L'envoi de fichiers ouvrira avec l'espace praticien.",
    files: "En attendant, envoyez vos fichiers (STL, ZIP) par e-mail :",
    mail: "Envoyer par e-mail",
    call: "Appeler",
    back: "Accueil",
    subject: "Nouveau cas",
  },
};

export default async function SendCase({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ dis?: string; urun?: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const { dis, urun } = await searchParams;
  const tooth = dis && /^[1-4][1-8]$/.test(dis) ? dis : null;
  const product = urun ? await publicProduct(urun) : null;
  const productName = product ? t(product.name, locale) : null;
  const c = COPY[locale];
  const st = await getSettings();
  const subject = encodeURIComponent([c.subject, productName, tooth ? `${c.tooth} ${tooth}` : null].filter(Boolean).join(" — "));

  return (
    <>
      <SiteHeader locale={locale} altPath="/vaka-gonder" />
      <main className="mx-auto max-w-3xl px-4 py-20 sm:px-6">
        <h1 className="display text-5xl font-semibold text-navy">{c.title}</h1>
        {productName && (
          <p className="mr-2 mt-6 inline-flex items-baseline gap-3 rounded-full bg-smile px-5 py-2 font-semibold text-navy">{productName}</p>
        )}
        {tooth && (
          <p className="mt-6 inline-flex items-baseline gap-3 rounded-full bg-navy px-5 py-2 text-white">
            <span className="text-sm text-white/70">{c.tooth}</span>
            <span className="display num text-2xl font-semibold text-smile">{tooth}</span>
          </p>
        )}
        <p className="mt-6 text-lg leading-relaxed text-slate">{c.lead}</p>
        <div className="mt-8 rounded-3xl border border-gypsum bg-white p-6 sm:p-8">
          <ContactForm
            locale={locale}
            topic="case"
            compact
            page={`/${locale}/vaka-gonder`}
            hidden={{ ...(tooth ? { tooth } : {}), ...(product ? { product: product.slug } : {}) }}
          />
        </div>
        <p className="mt-8 text-sm text-slate">{c.files}</p>
        <div className="mt-3 flex flex-wrap gap-3">
          <a href={`mailto:${st.email}?subject=${subject}`} className="rounded-full bg-navy px-6 py-3 font-semibold text-white hover:bg-blue">
            {c.mail}
          </a>
          <a href={telHref(st.phone)} className="rounded-full border border-navy px-6 py-3 font-semibold text-navy hover:bg-white">
            {c.call} {st.phone}
          </a>
          <Link href={`/${locale}`} className="px-2 py-3 font-semibold text-slate hover:text-navy">
            {c.back}
          </Link>
        </div>
      </main>
      <SiteFooter locale={locale} />
    </>
  );
}
