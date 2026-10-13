import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SiteFooter, SiteHeader } from "@/components/SiteChrome";
import { VisitForm, type VisitHost } from "@/components/VisitForm";
import { LOCALES, isLocale, type Locale } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";
import { ERP_URL } from "@/lib/handoff";

export const dynamic = "force-dynamic";

const COPY: Record<Locale, { title: string; lead: string; steps: [string, string][]; closed: string }> = {
  tr: {
    title: "Ziyaret randevusu",
    lead: "Laboratuvarımızı ziyaret etmek mi istiyorsunuz? Gelmeden önce randevu alın; ziyaret edeceğiniz kişi onaylasın, kapıda QR davetiyenizle bekleme olmadan girin.",
    steps: [["📅", "Gün ve saati seçip randevu isteyin"], ["✅", "Ziyaret edeceğiniz kişi onaylar"], ["📱", "QR davetiyeniz telefonunuza gelir"], ["🚪", "Kapıda QR'ı okutup girin"]],
    closed: "Şu an çevrim içi randevu kapalı. Lütfen bizi telefonla arayın.",
  },
  en: {
    title: "Book a visit",
    lead: "Planning to visit our laboratory? Book before you come; the person you are visiting approves, and you walk in at the gate with your QR invitation — no waiting.",
    steps: [["📅", "Pick a day and time and request"], ["✅", "The person you visit approves"], ["📱", "Your QR invitation arrives on your phone"], ["🚪", "Scan the QR at the gate and enter"]],
    closed: "Online booking is currently closed. Please give us a call.",
  },
  fr: {
    title: "Prendre rendez-vous",
    lead: "Vous souhaitez visiter notre laboratoire ? Réservez avant de venir ; la personne concernée valide et vous entrez à l’accueil avec votre invitation QR, sans attente.",
    steps: [["📅", "Choisissez jour et heure"], ["✅", "La personne concernée valide"], ["📱", "Votre invitation QR arrive sur votre téléphone"], ["🚪", "Scannez le QR à l’entrée"]],
    closed: "La prise de rendez-vous en ligne est fermée. Appelez-nous.",
  },
};

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  return { title: `${COPY[locale].title} — MB Dental`, description: COPY[locale].lead, alternates: { canonical: `/${locale}/ziyaret`, languages: Object.fromEntries(LOCALES.map((l) => [l, `/${l}/ziyaret`])) } };
}

export default async function VisitPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const c = COPY[locale];
  let hosts: VisitHost[] = [];
  try {
    const supabase = await createClient();
    const { data } = await supabase.rpc("vis_hosts_public");
    hosts = (data ?? []) as VisitHost[];
  } catch {
    hosts = [];
  }
  return (
    <>
      <SiteHeader locale={locale} altPath="/ziyaret" />
      <main>
        <section className="bg-navy text-white">
          <div className="mx-auto max-w-6xl px-4 pb-14 pt-8 sm:px-6">
            <h1 className="display text-5xl font-semibold sm:text-6xl">{c.title}</h1>
            <p className="mt-4 max-w-2xl text-lg text-white/75">{c.lead}</p>
            <ol className="mt-8 grid gap-3 sm:grid-cols-4">
              {c.steps.map(([icon, text], i) => (
                <li key={text} className="rounded-2xl bg-white/10 p-4">
                  <span className="text-2xl">{icon}</span>
                  <span className="mt-2 block text-sm font-semibold"><span className="text-smile">{i + 1}.</span> {text}</span>
                </li>
              ))}
            </ol>
          </div>
        </section>
        <div className="mx-auto max-w-3xl px-4 py-14 sm:px-6">
          <div className="rounded-3xl border border-gypsum bg-white p-6 sm:p-8">
            {hosts.length ? <VisitForm locale={locale} hosts={hosts} kvkkHref={ERP_URL ? `${ERP_URL}/kvkk-aydinlatma` : null} /> : <p className="text-ink">{c.closed}</p>}
          </div>
        </div>
      </main>
      <SiteFooter locale={locale} />
    </>
  );
}
