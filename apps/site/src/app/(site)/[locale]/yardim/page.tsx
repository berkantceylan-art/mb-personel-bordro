import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SiteFooter, SiteHeader } from "@/components/SiteChrome";
import { HelpTabs, type HelpVideoView } from "@/components/help/HelpTabs";
import { mediaUrl, publicAnnouncements, publicHelpVideos } from "@/lib/cms";
import { HELP_UI } from "@/lib/help-content";
import { LOCALES, isLocale, t, type Locale } from "@/lib/i18n";

export const revalidate = 120;

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const m = HELP_UI[locale].meta;
  return {
    title: `${m.title} — MB Dental`,
    description: m.description,
    alternates: { canonical: `/${locale}/yardim`, languages: Object.fromEntries(LOCALES.map((l) => [l, `/${l}/yardim`])) },
    openGraph: { title: m.title, description: m.description, siteName: "MB Dental", locale },
  };
}

/** YouTube / Vimeo bağlantısını gömülü oynatıcı adresine çevirir */
function embedUrl(u: string | null): string | null {
  if (!u) return null;
  try {
    const url = new URL(u);
    const host = url.hostname.replace(/^www\.|^m\./, "");
    if (host === "youtu.be") return `https://www.youtube-nocookie.com/embed/${url.pathname.slice(1)}`;
    if (host === "youtube.com") {
      const id = url.searchParams.get("v") ?? url.pathname.match(/\/(?:shorts|embed|live)\/([\w-]+)/)?.[1];
      return id ? `https://www.youtube-nocookie.com/embed/${id}` : null;
    }
    if (host === "vimeo.com") {
      const id = url.pathname.match(/\/(\d+)/)?.[1];
      return id ? `https://player.vimeo.com/video/${id}` : null;
    }
    if (host === "player.vimeo.com" || host === "youtube-nocookie.com") return u;
  } catch {
    return null;
  }
  return null;
}

const fmt = (iso: string, locale: Locale) => new Date(iso).toLocaleDateString(locale === "tr" ? "tr-TR" : locale === "fr" ? "fr-FR" : "en-GB", { day: "numeric", month: "long", year: "numeric" });

export default async function HelpPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const ui = HELP_UI[locale];
  const [videos, updates] = await Promise.all([publicHelpVideos(), publicAnnouncements("update")]);
  const vids: HelpVideoView[] = videos.map((v) => ({
    id: v.id,
    title: t(v.title, locale),
    description: t(v.description, locale),
    types: v.target_types ?? [],
    src: mediaUrl(v.video_path),
    embed: embedUrl(v.video_url),
    poster: mediaUrl(v.poster_path),
  })).filter((v) => v.title && (v.src || v.embed));
  const news = updates.filter((u) => t(u.title, locale)).slice(0, 12);

  return (
    <>
      <SiteHeader locale={locale} altPath="/yardim" current="help" />
      <main className="bg-porcelain">
        <section className="border-b border-gypsum bg-navy text-white">
          <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-20">
            <p className="text-sm font-semibold uppercase tracking-widest text-smile">{ui.kicker}</p>
            <h1 className="display mt-3 max-w-3xl text-4xl font-semibold sm:text-5xl">{ui.title}</h1>
            <p className="mt-4 max-w-2xl text-lg text-white/75">{ui.lead}</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <a href={`/portal/kayit?dil=${locale}`} className="rounded-full bg-smile px-6 py-3 font-semibold text-navy hover:bg-white">{ui.openAccount}</a>
              <Link href="/giris" className="rounded-full border border-white/30 px-6 py-3 font-semibold hover:border-white">{ui.signIn}</Link>
            </div>
          </div>
        </section>

        <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-widest text-slate">{ui.choose}</h2>
          <HelpTabs ui={ui} videos={vids} signupHref={`/portal/kayit?dil=${locale}`} />
        </div>

        {/* Neden portal? */}
        <section aria-labelledby="neden" className="border-y border-gypsum bg-white">
          <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
            <h2 id="neden" className="display text-2xl font-semibold text-navy sm:text-3xl">{ui.whyTitle}</h2>
            <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {ui.why.map((w) => (
                <li key={w.t} className="rounded-2xl bg-porcelain p-5">
                  <span className="text-3xl" aria-hidden>{w.icon}</span>
                  <h3 className="mt-2 font-semibold text-navy">{w.t}</h3>
                  <p className="mt-1 text-sm text-slate">{w.d}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Yenilikler (ERP › Site içerikleri › Güncelleme duyurusu) */}
        <section id="yenilikler" aria-labelledby="yenilikler-baslik" className="scroll-mt-20">
          <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
            <h2 id="yenilikler-baslik" className="display text-2xl font-semibold text-navy sm:text-3xl">{ui.updatesTitle}</h2>
            <p className="mt-1 text-slate">{ui.updatesLead}</p>
            {news.length ? (
              <ol className="mt-6 grid gap-3 border-l-2 border-smile pl-6">
                {news.map((u) => (
                  <li key={u.id} className="relative rounded-2xl bg-white p-5">
                    <span className="absolute -left-[33px] top-6 h-3.5 w-3.5 rounded-full border-2 border-white bg-smile" aria-hidden />
                    <time className="text-xs font-semibold uppercase tracking-wide text-slate">{fmt(u.starts_at ?? u.updated_at, locale)}</time>
                    <h3 className="mt-1 font-semibold text-navy">{t(u.title, locale)}</h3>
                    {t(u.body, locale) && <p className="mt-1 whitespace-pre-line text-ink">{t(u.body, locale)}</p>}
                    {u.link_href && <a href={u.link_href} className="mt-2 inline-block text-sm font-semibold text-smile-ink hover:underline">→</a>}
                  </li>
                ))}
              </ol>
            ) : (
              <p className="mt-6 rounded-2xl bg-white p-5 text-slate">{ui.updatesEmpty}</p>
            )}
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 pb-16 sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-3xl bg-navy p-8 text-white">
            <div>
              <h2 className="display text-2xl font-semibold">{ui.helpTitle}</h2>
              <p className="mt-1 text-white/70">{ui.helpText}</p>
            </div>
            <Link href={`/${locale}/iletisim`} className="rounded-full bg-smile px-6 py-3 font-semibold text-navy hover:bg-white">{ui.contact}</Link>
          </div>
        </section>
      </main>
      <SiteFooter locale={locale} />
    </>
  );
}
