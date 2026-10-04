import Link from "next/link";
import { notFound } from "next/navigation";
import { SiteFooter, SiteHeader } from "@/components/SiteChrome";
import { CONTACT, isLocale, type Locale } from "@/lib/i18n";

export const dynamic = "force-dynamic";

const COPY: Record<Locale, { title: string; tooth: string; lead: string; mail: string; call: string; back: string; subject: string }> = {
  tr: {
    title: "Vaka gönder",
    tooth: "Seçilen diş",
    lead: "Çevrim içi vaka formu ve dosya yükleme hekim portalıyla birlikte açılacak. O zamana kadar vakanızı e-postayla gönderin ya da bizi arayın; tarama dosyalarını (STL, ZIP) e-postaya ekleyebilirsiniz.",
    mail: "E-postayla gönder",
    call: "Ara",
    back: "Anasayfa",
    subject: "Yeni vaka",
  },
  en: {
    title: "Send a case",
    tooth: "Selected tooth",
    lead: "The online case form and file upload will open with the dentist portal. Until then, email us your case or give us a call; you can attach scan files (STL, ZIP).",
    mail: "Send by email",
    call: "Call",
    back: "Home",
    subject: "New case",
  },
  fr: {
    title: "Envoyer un cas",
    tooth: "Dent sélectionnée",
    lead: "Le formulaire en ligne et l'envoi de fichiers ouvriront avec l'espace praticien. D'ici là, envoyez votre cas par e-mail ou appelez-nous ; vous pouvez joindre vos fichiers (STL, ZIP).",
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
  searchParams: Promise<{ dis?: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const { dis } = await searchParams;
  const tooth = dis && /^[1-4][1-8]$/.test(dis) ? dis : null;
  const c = COPY[locale];
  const subject = encodeURIComponent(tooth ? `${c.subject} — ${c.tooth} ${tooth}` : c.subject);

  return (
    <>
      <SiteHeader locale={locale} />
      <main className="mx-auto max-w-3xl px-4 py-20 sm:px-6">
        <h1 className="display text-5xl font-semibold text-navy">{c.title}</h1>
        {tooth && (
          <p className="mt-6 inline-flex items-baseline gap-3 rounded-full bg-navy px-5 py-2 text-white">
            <span className="text-sm text-white/70">{c.tooth}</span>
            <span className="display num text-2xl font-semibold text-smile">{tooth}</span>
          </p>
        )}
        <p className="mt-6 text-lg leading-relaxed text-slate">{c.lead}</p>
        <div className="mt-8 flex flex-wrap gap-3">
          <a href={`mailto:${CONTACT.email}?subject=${subject}`} className="rounded-full bg-navy px-6 py-3 font-semibold text-white hover:bg-blue">
            {c.mail}
          </a>
          <a href={CONTACT.phoneHref} className="rounded-full border border-navy px-6 py-3 font-semibold text-navy hover:bg-white">
            {c.call} {CONTACT.phone}
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
