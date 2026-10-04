import Link from "next/link";
import { CONTACT, DICTS, LOCALES, LOCALE_NAMES, t, type Locale } from "@/lib/i18n";
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

export function SiteHeader({ locale }: { locale: Locale }) {
  const d = DICTS[locale];
  const links: [string, string][] = [
    ["#urunler", d.nav.products],
    ["#teknoloji", d.nav.technology],
    ["#teslimat", d.nav.delivery],
    ["#kalite", d.nav.quality],
    ["#iletisim", d.nav.contact],
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
          {links.map(([href, label]) => (
            <a key={href} href={href} className="hover:text-white">
              {label}
            </a>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-3">
          <nav aria-label="Dil" className="flex gap-1 text-xs">
            {LOCALES.map((l) => (
              <Link
                key={l}
                href={`/${l}`}
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

export function SiteFooter({ locale }: { locale: Locale }) {
  const d = DICTS[locale];
  return (
    <footer id="iletisim" className="bg-navy text-white">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 sm:px-6 md:grid-cols-[1.2fr_1fr_1fr]">
        <div>
          <div className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.svg" alt="" width={44} height={44} className="h-11 w-11" />
            <span className="display text-2xl font-semibold">MB Dental</span>
          </div>
          <p className="mt-4 max-w-xs text-sm text-white/70">{d.meta.description}</p>
        </div>
        <div>
          <h2 className="display text-lg font-semibold">{d.contact.title}</h2>
          <dl className="mt-3 space-y-2 text-sm text-white/80">
            <div>
              <dt className="text-white/50">{d.contact.phone}</dt>
              <dd>
                <a href={CONTACT.phoneHref} className="hover:text-smile">
                  {CONTACT.phone}
                </a>
              </dd>
            </div>
            <div>
              <dt className="text-white/50">{d.contact.email}</dt>
              <dd>
                <a href={`mailto:${CONTACT.email}`} className="hover:text-smile">
                  {CONTACT.email}
                </a>
              </dd>
            </div>
          </dl>
        </div>
        <div>
          <h2 className="display text-lg font-semibold">{d.contact.address}</h2>
          <address className="mt-3 text-sm not-italic text-white/80">
            {CONTACT.address.map((l) => (
              <span key={l} className="block">
                {l}
              </span>
            ))}
          </address>
        </div>
      </div>
      <div className="border-t border-white/10">
        <p className="mx-auto max-w-6xl px-4 py-5 text-xs text-white/50 sm:px-6">
          © {new Date().getFullYear()} MB Dental. {d.footer.rights}
        </p>
      </div>
    </footer>
  );
}
