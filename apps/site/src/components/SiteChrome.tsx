import Link from "next/link";
import { DICTS, LOCALES, LOCALE_NAMES, t, type Locale } from "@/lib/i18n";
import { getSettings, telHref } from "@/lib/settings";
import type { Announcement } from "@/lib/cms";

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

/** altPath: dil değiştirince aynı sayfada kalmak için dil önekinden sonraki yol (ör. "/urunler/zirkonyum") */
export function SiteHeader({ locale, altPath = "", current }: { locale: Locale; altPath?: string; current?: "products" | "contact" }) {
  const d = DICTS[locale];
  const links: [string, string, boolean][] = [
    [`/${locale}/urunler`, d.nav.products, current === "products"],
    [`/${locale}#teknoloji`, d.nav.technology, false],
    [`/${locale}#teslimat`, d.nav.delivery, false],
    [`/${locale}#kalite`, d.nav.quality, false],
    [`/${locale}/iletisim`, d.nav.contact, current === "contact"],
  ];
  return (
    <header className="bg-navy text-white">
      <div className="mx-auto flex max-w-6xl items-center gap-6 px-4 py-4 sm:px-6">
        <Link href={`/${locale}`} className="flex items-center gap-3" aria-label="MB Dental">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.svg" alt="" width={40} height={40} className="h-10 w-10" />
          <span className="display text-xl font-semibold tracking-tight">MB Dental</span>
        </Link>
        <nav aria-label="Ana menü" className="ml-4 hidden gap-5 text-sm text-white/80 lg:flex">
          {links.map(([href, label, on]) => (
            <Link key={href} href={href} aria-current={on ? "page" : undefined} className="hover:text-white aria-[current=page]:font-semibold aria-[current=page]:text-white">
              {label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-3">
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
        </div>
      </div>
    </header>
  );
}

const SOCIAL_ICONS: Record<"instagram" | "facebook" | "linkedin" | "youtube", { label: string; path: string }> = {
  instagram: {
    label: "Instagram",
    path: "M7 2h10a5 5 0 0 1 5 5v10a5 5 0 0 1-5 5H7a5 5 0 0 1-5-5V7a5 5 0 0 1 5-5zm5 5.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9zM17.5 6a1 1 0 1 0 0 2 1 1 0 0 0 0-2z",
  },
  facebook: { label: "Facebook", path: "M14 8h3V4h-3a4 4 0 0 0-4 4v2H8v4h2v8h4v-8h3l1-4h-4V8z" },
  linkedin: { label: "LinkedIn", path: "M4 9h4v12H4zM6 3a2 2 0 1 1 0 4 2 2 0 0 1 0-4zm4 6h4v2c.6-1.1 2-2.2 4-2.2 4 0 4.5 2.6 4.5 6V21h-4v-5.5c0-1.4 0-3.2-2-3.2s-2.3 1.5-2.3 3.1V21h-4z" },
  youtube: { label: "YouTube", path: "M22 8.2a3 3 0 0 0-2.1-2.1C18 5.6 12 5.6 12 5.6s-6 0-7.9.5A3 3 0 0 0 2 8.2 31 31 0 0 0 1.6 12a31 31 0 0 0 .4 3.8 3 3 0 0 0 2.1 2.1c1.9.5 7.9.5 7.9.5s6 0 7.9-.5a3 3 0 0 0 2.1-2.1 31 31 0 0 0 .4-3.8 31 31 0 0 0-.4-3.8zM10 15.2V8.8l5.2 3.2z" },
};

const FOOTER_COPY: Record<Locale, { hours: string; map: string; write: string; whatsapp: string }> = {
  tr: { hours: "Çalışma saatleri", map: "Haritada aç", write: "Bize yazın", whatsapp: "WhatsApp ile yazın" },
  en: { hours: "Opening hours", map: "Open in maps", write: "Write to us", whatsapp: "Message us on WhatsApp" },
  fr: { hours: "Horaires", map: "Ouvrir le plan", write: "Écrivez-nous", whatsapp: "Écrivez-nous sur WhatsApp" },
};

export async function SiteFooter({ locale }: { locale: Locale }) {
  const d = DICTS[locale];
  const st = await getSettings();
  const fc = FOOTER_COPY[locale];
  const hours = t(st.hours, locale);
  const blurb = t(st.footer_text, locale) || d.meta.description;
  const socials = (Object.keys(SOCIAL_ICONS) as (keyof typeof SOCIAL_ICONS)[]).filter((k) => st.social[k]);
  return (
    <>
      <footer id="iletisim" className="bg-navy text-white">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 sm:px-6 md:grid-cols-[1.2fr_1fr_1fr]">
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
              {hours && (
                <div>
                  <dt className="text-white/50">{fc.hours}</dt>
                  <dd className="whitespace-pre-line">{hours}</dd>
                </div>
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
      {st.whatsapp && (
        <a
          href={`https://wa.me/${st.whatsapp}`}
          target="_blank"
          rel="noreferrer"
          aria-label={fc.whatsapp}
          title={fc.whatsapp}
          className="fixed bottom-5 right-5 z-40 grid h-14 w-14 place-items-center rounded-full bg-[#1f8f4e] text-white shadow-lg shadow-ink/25 hover:scale-105 hover:bg-[#17733e]"
        >
          <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2a8.2 8.2 0 0 1-4.2-1.1l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8s-.4-.1-.6.1-.7.8-.8 1-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.2-.4.6-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.3.8 3.2.6a2.7 2.7 0 0 0 1.8-1.2 2.2 2.2 0 0 0 .2-1.3c-.1-.1-.3-.2-.5-.3z" />
          </svg>
        </a>
      )}
    </>
  );
}
