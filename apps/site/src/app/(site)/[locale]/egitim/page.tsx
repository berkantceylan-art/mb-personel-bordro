import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SiteFooter, SiteHeader } from "@/components/SiteChrome";
import { publicEvents } from "@/lib/cms";
import { LOCALES, isLocale, t } from "@/lib/i18n";
import { EVT_UI, when } from "@/lib/pages-ui";

export const revalidate = 120;

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  return { title: `${EVT_UI[locale].title} — MB Dental`, description: EVT_UI[locale].lead, alternates: { canonical: `/${locale}/egitim`, languages: Object.fromEntries(LOCALES.map((l) => [l, `/${l}/egitim`])) } };
}

export default async function EventsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const u = EVT_UI[locale];
  const evs = await publicEvents();
  const now = Date.now();
  const up = evs.filter((e) => new Date(e.starts_at).getTime() >= now), past = evs.filter((e) => new Date(e.starts_at).getTime() < now).reverse();
  const Card = ({ e }: { e: (typeof evs)[number] }) => (
    <li><Link href={`/${locale}/egitim/${e.slug}`} className="block h-full rounded-2xl border border-gypsum bg-white p-5 hover:border-navy">
      <span className="text-xs font-semibold uppercase tracking-wider text-smile-ink">{u.mode[e.mode]} · {e.duration_min} {u.minutes}</span>
      <b className="mt-1 block text-lg text-ink">{t(e.title, locale)}</b>
      <span className="mt-1 block text-sm text-slate">{when(e.starts_at, locale)}{e.speaker ? ` · ${e.speaker}` : ""}</span>
    </Link></li>
  );
  return (
    <>
      <SiteHeader locale={locale} altPath="/egitim" />
      <main>
        <section className="bg-navy text-white"><div className="mx-auto max-w-6xl px-4 pb-14 pt-8 sm:px-6"><h1 className="display text-5xl font-semibold tracking-tight sm:text-6xl">{u.title}</h1><p className="mt-4 max-w-2xl text-xl text-white/80">{u.lead}</p></div></section>
        <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
          <h2 className="display text-2xl font-semibold text-navy">{u.upcoming}</h2>
          {up.length ? <ul className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{up.map((e) => <Card key={e.id} e={e} />)}</ul> : <p className="mt-3 text-slate">{u.none}</p>}
          {past.length > 0 && <><h2 className="display mt-12 text-2xl font-semibold text-navy">{u.past}</h2><ul className="mt-4 grid gap-4 opacity-80 sm:grid-cols-2 lg:grid-cols-3">{past.slice(0, 12).map((e) => <Card key={e.id} e={e} />)}</ul></>}
        </div>
      </main>
      <SiteFooter locale={locale} />
    </>
  );
}
