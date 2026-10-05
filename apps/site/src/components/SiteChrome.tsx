import Link from "next/link";
import { CASE_UI, DICTS, LOCALES, LOCALE_NAMES, t, type Locale } from "@/lib/i18n";
import { getSettings, telHref } from "@/lib/settings";
import { aiEnabled } from "@/lib/ai";
import { hasSupabase, publicPages, type Announcement } from "@/lib/cms";
import { groupedSchedule, hasSchedule } from "@/lib/hours";
import { MobileMenu } from "./MobileMenu";
import { SupportHub } from "./SupportHub";

export function AnnouncementBar({ items, locale }: { items: Announcement[]; locale: Locale }) {
  const a = items[0];
  if (!a) return null;
  const title = t(a.title, locale);
  const body = t(a.body, locale);
  if (!title && !body) return null;
  const inner = (
    <>
      <span className="font-semibold">{title}</span>
      {body && <span className="text-navy/80"> {body}</span>}
    </>
  );
  return (
    <div className="bg-smile text-navy">
      <p className="mx-auto max-w-6xl px-4 py-2 text-center text-sm sm:px-6">
        {a.link_href ? (
          <a href={a.link_href} className="underline-offset-4 hover:underline">
            {inner}
          </a>
        ) : (
          inner
        )}
      </p>
    </div>
  );
}

const FAQ_LABEL: Record<Locale, string> = { tr: "Sıkça sorulanlar", en: "FAQ", fr: "FAQ" };
const ABOUT: Record<Locale, string> = { tr: "Hakkımızda", en: "About", fr: "À propos" };

const NAV_EXTRA: Record<Locale, { team: string; faq: string; cases: string; menu: string; close: string; portal: string }> = {
  tr: { team: "Ekibimiz", faq: "SSS", cases: "Vakalar", menu: "Menü", close: "Menüyü kapat", portal: "Hekim portalı" },
  en: { team: "Team", faq: "FAQ", cases: "Cases", menu: "Menu", close: "Close menu", portal: "Doctor portal" },
  fr: { team: "Équipe", faq: "FAQ", cases: "Cas", menu: "Menu", close: "Fermer le menu", portal: "Portail praticien" },
};

/** altPath: dil değiştirince aynı sayfada kalmak için dil önekinden sonraki yol (ör. "/urunler/zirkonyum") */
export function SiteHeader({ locale, altPath = "", current }: { locale: Locale; altPath?: string; current?: "products" | "contact" | "about" | "team" | "faq" | "cases" }) {
  const d = DICTS[locale];
  const x = NAV_EXTRA[locale];
  const links: [string, string, boolean][] = [
    [`/${locale}/urunler`, d.nav.products, current === "products"],
    [`/${locale}/vakalar`, x.cases, current === "cases"],
    [`/${locale}#teknoloji`, d.nav.technology, false],
    [`/${locale}/hakkimizda`, ABOUT[locale], current === "about"],
    [`/${locale}/ekibimiz`, x.team, current === "team"],
    [`/${locale}/sss`, x.faq, current === "faq"],
    [`/${locale}/iletisim`, d.nav.contact, current === "contact"],
  ];
  return (
    <header className="site-header sticky top-0 z-40 bg-navy/95 text-white backdrop-blur supports-[backdrop-filter]:bg-navy/85">
      <div className="mx-auto flex max-w-6xl items-center gap-6 px-4 py-3.5 sm:px-6">
        <Link href={`/${locale}`} className="flex shrink-0 items-center gap-3" aria-label="MB Dental">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.svg" alt="" width={40} height={40} className="h-10 w-10" />
          <span className="display text-xl font-semibold tracking-tight">MB Dental</span>
        </Link>
        <nav aria-label="Ana menü" className="ml-2 hidden gap-5 text-sm text-white/80 xl:flex">
          {links.map(([href, label, on]) => (
            <Link key={href} href={href} aria-current={on ? "page" : undefined} className="nav-link hover:text-white aria-[current=page]:font-semibold aria-[current=page]:text-white">
              {label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2 sm:gap-3">
          <nav aria-label="Dil" className="flex gap-1 text-xs">
            {LOCALES.map((l) => (
              <Link
                key={l}
                href={`/${l}${altPath}`}
                hrefLang={l}
                lang={l}
                aria-current={l === locale ? "true" : undefined}
                title={LOCALE_NAMES[l]}
                className={`rounded px-1.5 py-1 uppercase ${l === locale ? "bg-white/15 text-white" : "text-white/60 hover:text-white"}`}
              >
                {l}
              </Link>
            ))}
          </nav>
          <Link href="/giris" className="hidden rounded-full border border-white/30 px-4 py-2 text-sm hover:border-white sm:inline-block">
            {d.nav.login}
          </Link>
          <MobileMenu
            links={links.map(([href, label, on]) => ({ href, label, on }))}
            extra={[
              { href: `/${locale}/vaka-gonder`, label: d.nav.sendCase },
              { href: "/portal", label: x.portal },
              { href: "/giris", label: d.nav.login },
            ]}
            labels={{ menu: x.menu, close: x.close }}
          />
        </div>
      </div>
    </header>
  );
}

export const SOCIAL_ICONS: Record<"instagram" | "facebook" | "linkedin" | "youtube" | "tiktok" | "x", { label: string; path: string }> = {
  instagram: {
    label: "Instagram",
    path: "M7 2h10a5 5 0 0 1 5 5v10a5 5 0 0 1-5 5H7a5 5 0 0 1-5-5V7a5 5 0 0 1 5-5zm5 5.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9zM17.5 6a1 1 0 1 0 0 2 1 1 0 0 0 0-2z",
  },
  facebook: { label: "Facebook", path: "M14 8h3V4h-3a4 4 0 0 0-4 4v2H8v4h2v8h4v-8h3l1-4h-4V8z" },
  linkedin: { label: "LinkedIn", path: "M4 9h4v12H4zM6 3a2 2 0 1 1 0 4 2 2 0 0 1 0-4zm4 6h4v2c.6-1.1 2-2.2 4-2.2 4 0 4.5 2.6 4.5 6V21h-4v-5.5c0-1.4 0-3.2-2-3.2s-2.3 1.5-2.3 3.1V21h-4z" },
  tiktok: { label: "TikTok", path: "M16.5 3c.4 2.3 1.9 3.9 4.5 4.1v3.3a7.6 7.6 0 0 1-4.4-1.4v6.3A6.2 6.2 0 1 1 10.4 9v3.4a2.9 2.9 0 1 0 2.8 2.9V3z" },
  x: { label: "X", path: "M17.8 3h3.1l-6.8 7.8 8 10.2h-6.3l-4.9-6.4L5.3 21H2.2l7.3-8.3L1.8 3h6.4l4.4 5.9zm-1.1 16.2h1.7L7.4 4.7H5.6z" },
  youtube: { label: "YouTube", path: "M22 8.2a3 3 0 0 0-2.1-2.1C18 5.6 12 5.6 12 5.6s-6 0-7.9.5A3 3 0 0 0 2 8.2 31 31 0 0 0 1.6 12a31 31 0 0 0 .4 3.8 3 3 0 0 0 2.1 2.1c1.9.5 7.9.5 7.9.5s6 0 7.9-.5a3 3 0 0 0 2.1-2.1 31 31 0 0 0 .4-3.8 31 31 0 0 0-.4-3.8zM10 15.2V8.8l5.2 3.2z" },
};

const FOOTER_COPY: Record<Locale, { hours: string; map: string; write: string; whatsapp: string; pages: string }> = {
  tr: { hours: "Çalışma saatleri", map: "Haritada aç", write: "Bize yazın", whatsapp: "WhatsApp ile yazın", pages: "Kurumsal" },
  en: { hours: "Opening hours", map: "Open in maps", write: "Write to us", whatsapp: "Message us on WhatsApp", pages: "Company" },
  fr: { hours: "Horaires", map: "Ouvrir le plan", write: "Écrivez-nous", whatsapp: "Écrivez-nous sur WhatsApp", pages: "Entreprise" },
};

export async function SiteFooter({ locale }: { locale: Locale }) {
  const d = DICTS[locale];
  const st = await getSettings();
  const fc = FOOTER_COPY[locale];
  const hours = t(st.hours, locale);
  const blurb = t(st.footer_text, locale) || d.meta.description;
  const socials = (Object.keys(SOCIAL_ICONS) as (keyof typeof SOCIAL_ICONS)[]).filter((k) => st.social[k]);
  const pages = (await publicPages()).filter((p) => p.show_in_footer);
  return (
    <>
      <footer id="iletisim" className="bg-navy text-white">
        <div className={`mx-auto grid max-w-6xl gap-10 px-4 py-14 sm:px-6 ${pages.length ? "md:grid-cols-2 lg:grid-cols-[1.2fr_1fr_1fr_1fr]" : "md:grid-cols-[1.2fr_1fr_1fr]"}`}>
          <div>
            <div className="flex items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/logo.svg" alt="" width={44} height={44} className="h-11 w-11" />
              <span className="display text-2xl font-semibold">MB Dental</span>
            </div>
            <p className="mt-4 max-w-xs whitespace-pre-line text-sm text-white/70">{blurb}</p>
            {socials.length > 0 && (
              <ul className="mt-5 flex gap-2">
                {socials.map((k) => (
                  <li key={k}>
                    <a
                      href={st.social[k]}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={SOCIAL_ICONS[k].label}
                      className="grid h-10 w-10 place-items-center rounded-full bg-white/10 hover:bg-smile hover:text-navy"
                    >
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                        <path d={SOCIAL_ICONS[k].path} />
                      </svg>
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {pages.length > 0 && (
            <nav aria-label={fc.pages}>
              <h2 className="display text-lg font-semibold">{fc.pages}</h2>
              <ul className="mt-3 space-y-2 text-sm text-white/80">
                <li>
                  <Link href={`/${locale}/urunler`} className="hover:text-smile">
                    {d.nav.products}
                  </Link>
                </li>
                <li>
                  <Link href={`/${locale}/vakalar`} className="hover:text-smile">
                    {CASE_UI[locale].title}
                  </Link>
                </li>
                <li>
                  <Link href={`/${locale}/ekibimiz`} className="hover:text-smile">
                    {NAV_EXTRA[locale].team}
                  </Link>
                </li>
                <li>
                  <Link href={`/${locale}/sss`} className="hover:text-smile">
                    {FAQ_LABEL[locale]}
                  </Link>
                </li>
                {pages.map((p) => (
                  <li key={p.id}>
                    <Link href={`/${locale}/${p.slug}`} className="hover:text-smile">
                      {t(p.title, locale)}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          )}
          <div>
            <h2 className="display text-lg font-semibold">{d.contact.title}</h2>
            <dl className="mt-3 space-y-2 text-sm text-white/80">
              <div>
                <dt className="text-white/50">{d.contact.phone}</dt>
                <dd>
                  <a href={telHref(st.phone)} className="hover:text-smile">
                    {st.phone}
                  </a>
                </dd>
              </div>
              <div>
                <dt className="text-white/50">{d.contact.email}</dt>
                <dd>
                  <a href={`mailto:${st.email}`} className="hover:text-smile">
                    {st.email}
                  </a>
                </dd>
              </div>
              {hasSchedule(st.schedule) ? (
                <div>
                  <dt className="text-white/50">{fc.hours}</dt>
                  {groupedSchedule(st.schedule, locale).map((g) => (
                    <dd key={g.days} className="flex justify-between gap-4">
                      <span>{g.days}</span>
                      <span className="tabular-nums">{g.hours}</span>
                    </dd>
                  ))}
                  {hours && <dd className="mt-1 whitespace-pre-line text-white/60">{hours}</dd>}
                </div>
              ) : (
                hours && (
                  <div>
                    <dt className="text-white/50">{fc.hours}</dt>
                    <dd className="whitespace-pre-line">{hours}</dd>
                  </div>
                )
              )}
            </dl>
            <Link href={`/${locale}/iletisim`} className="mt-4 inline-block rounded-full border border-white/30 px-4 py-2 text-sm font-semibold hover:border-white">
              {fc.write}
            </Link>
          </div>
          <div>
            <h2 className="display text-lg font-semibold">{d.contact.address}</h2>
            <address className="mt-3 text-sm not-italic text-white/80">
              {[st.address1, st.address2].filter(Boolean).map((l) => (
                <span key={l} className="block">
                  {l}
                </span>
              ))}
            </address>
            {st.map_url && (
              <a href={st.map_url} target="_blank" rel="noreferrer" className="mt-3 inline-block text-sm font-semibold text-smile hover:underline">
                {fc.map} ↗
              </a>
            )}
          </div>
        </div>
        <div className="border-t border-white/10">
          <p className="mx-auto max-w-6xl px-4 py-5 text-xs text-white/50 sm:px-6">
            © {new Date().getFullYear()} MB Dental. {d.footer.rights}
          </p>
        </div>
      </footer>
      <SupportHub
        locale={locale}
        phone={st.phone}
        tel={telHref(st.phone)}
        email={st.email}
        whatsapp={st.whatsapp}
        schedule={st.schedule}
        chatEnabled={st.chat_enabled && hasSupabase()}
        aiActive={aiEnabled() && st.ai_assistant !== "off"}
      />
    </>
  );
}
