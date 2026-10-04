import Link from "next/link";
import { notFound } from "next/navigation";
import { AnnouncementBar, SiteFooter, SiteHeader } from "@/components/SiteChrome";
import { ToothChart } from "@/components/ToothChart";
import { Stories, type StoryView } from "@/components/Stories";
import { PRODUCT_CATEGORIES, mediaUrl, publicAnnouncements, publicPages, publicProducts, publicSlides, publicStories } from "@/lib/cms";
import { mediaKind } from "@/lib/media";
import { getSettings, telHref } from "@/lib/settings";
import { DICTS, PAGE_UI, PRODUCT_UI, isLocale, t, type Locale } from "@/lib/i18n";

export const revalidate = 60;

const TOOTH_WORD: Record<Locale, string> = { tr: "Diş", en: "Tooth", fr: "Dent" };
const NEWS_TITLE: Record<Locale, string> = { tr: "Duyurular", en: "News", fr: "Actualités" };
const STORY_LABELS: Record<Locale, { title: string; close: string; prev: string; next: string; mute: string; unmute: string; pause: string; play: string }> = {
  tr: { title: "Hikâyeler", close: "Kapat", prev: "Önceki", next: "Sonraki", mute: "Sesi kapat", unmute: "Sesi aç", pause: "Duraklat", play: "Oynat" },
  en: { title: "Stories", close: "Close", prev: "Previous", next: "Next", mute: "Mute", unmute: "Unmute", pause: "Pause", play: "Play" },
  fr: { title: "Stories", close: "Fermer", prev: "Précédent", next: "Suivant", mute: "Couper le son", unmute: "Activer le son", pause: "Pause", play: "Lecture" },
};

export default async function Home({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const d = DICTS[locale];
  const [banners, news, slides, products, storyRows, pages] = await Promise.all([
    publicAnnouncements("banner"),
    publicAnnouncements("news"),
    publicSlides("home"),
    publicProducts(),
    publicStories(),
    publicPages(),
  ]);
  const techPages = pages.filter((p) => p.group === "teknoloji");
  const qualityPages = pages.filter((p) => p.group === "kalite");
  const st = await getSettings();
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? "https://mbdentaire.com";
  // Arama motorları için kurum bilgisi
  const orgLd = {
    "@context": "https://schema.org",
    "@type": "MedicalBusiness",
    name: "MB Dental",
    description: d.meta.description,
    url: `${site}/${locale}`,
    logo: `${site}/logo.svg`,
    telephone: telHref(st.phone).replace("tel:", ""),
    email: st.email,
    address: { "@type": "PostalAddress", streetAddress: st.address1, addressLocality: st.address2, addressCountry: "TR" },
    sameAs: Object.values(st.social).filter(Boolean),
  };
  const stories: StoryView[] = storyRows.map((s) => {
    const first = s.frames[0]?.path ?? null;
    const coverPath = s.cover_path ?? first;
    const label = t(s.link_label, locale);
    return {
      id: s.id,
      version: s.updated_at,
      title: t(s.title, locale),
      cover: mediaUrl(coverPath),
      coverIsVideo: !s.cover_path && !!first && mediaKind(null, first) === "video",
      frames: s.frames.map((f) => ({
        url: mediaUrl(f.path) ?? "",
        kind: mediaKind(null, f.path) === "video" ? ("video" as const) : ("image" as const),
        caption: t(f.caption, locale),
      })),
      link: s.link_href && label ? { href: s.link_href, label } : null,
    };
  });
  // Ürünler admin panelinden gelir; veritabanı boşsa sözlükteki sabit liste gösterilir
  const productGroups =
    products.length > 0
      ? PRODUCT_CATEGORIES.map((c) => ({
          name: PRODUCT_UI[locale].categories[c],
          items: products.filter((p) => p.category === c).map((p) => ({ name: t(p.name, locale), note: t(p.summary, locale), href: `/${locale}/urunler/${p.slug}` })),
        })).filter((g) => g.items.length > 0)
      : d.products.groups.map((g) => ({ ...g, items: g.items.map((it) => ({ ...it, href: undefined as string | undefined })) }));

  return (
    <>
      <AnnouncementBar items={banners} locale={locale} />
      <SiteHeader locale={locale} />

      <main>
        {/* Hero: diş şeması */}
        <section className="bg-navy text-white">
          <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 pb-16 pt-10 sm:px-6 lg:grid-cols-[1fr_1.05fr] lg:pb-24 lg:pt-16">
            <div className="max-w-xl">
              <h1 className="display text-5xl font-semibold leading-[1.02] sm:text-6xl lg:text-7xl">{d.hero.title}</h1>
              <p className="mt-6 max-w-[34rem] text-lg leading-relaxed text-white/75">{d.hero.lead}</p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Link href={`/${locale}/vaka-gonder`} className="rounded-full bg-smile px-6 py-3 font-semibold text-navy hover:bg-white">
                  {d.hero.send}
                </Link>
                <Link href="/giris" className="rounded-full border border-white/30 px-6 py-3 font-semibold hover:border-white">
                  {d.hero.login}
                </Link>
              </div>
            </div>
            <ToothChart locale={locale} upperLabel={d.hero.upper} lowerLabel={d.hero.lower} hint={d.hero.chartHint} toothWord={TOOTH_WORD[locale]} />
          </div>
        </section>

        {/* Hikâyeler (admin panelinden) */}
        {stories.length > 0 && (
          <section aria-label={STORY_LABELS[locale].title} className="border-b border-gypsum bg-white">
            <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
              <Stories stories={stories} labels={STORY_LABELS[locale]} />
            </div>
          </section>
        )}

        {/* Admin panelinden yönetilen slaytlar */}
        {slides.length > 0 && (
          <section aria-labelledby="slaytlar" className="border-b border-gypsum bg-white">
            <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
              <h2 id="slaytlar" className="display text-3xl font-semibold text-navy">
                {d.slides.title}
              </h2>
              <ul className="mt-8 flex snap-x gap-5 overflow-x-auto pb-2">
                {slides.map((s) => {
                  const img = mediaUrl(s.image_path);
                  const title = t(s.title, locale);
                  const sub = t(s.subtitle, locale);
                  const label = t(s.button_label, locale);
                  return (
                    <li key={s.id} className="w-[min(85vw,420px)] shrink-0 snap-start">
                      <div className="aspect-[4/3] overflow-hidden rounded-2xl bg-gypsum">
                        {img && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={img} alt={title} className="h-full w-full object-cover" loading="lazy" />
                        )}
                      </div>
                      {title && <h3 className="display mt-4 text-xl font-semibold text-navy">{title}</h3>}
                      {sub && <p className="mt-1 text-slate">{sub}</p>}
                      {label && s.button_href && (
                        <a href={s.button_href} className="mt-3 inline-block font-semibold text-smile-ink underline-offset-4 hover:underline">
                          {label}
                        </a>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          </section>
        )}

        {/* Ürünler */}
        <section id="urunler" aria-labelledby="urunler-baslik" className="scroll-mt-6">
          <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
            <div className="max-w-2xl">
              <h2 id="urunler-baslik" className="display text-4xl font-semibold text-navy">
                {d.products.title}
              </h2>
              <p className="mt-3 text-lg text-slate">{d.products.lead}</p>
            </div>
            <div className="mt-12 grid gap-12 md:grid-cols-3">
              {productGroups.map((g) => (
                <div key={g.name}>
                  <h3 className="display border-b-2 border-navy pb-3 text-xl font-semibold text-navy">{g.name}</h3>
                  <ul>
                    {g.items.map((it) => (
                      <li key={it.name} className="border-b border-gypsum">
                        {it.href ? (
                          <Link href={it.href} className="group block py-4">
                            <span className="flex items-center justify-between gap-3 font-semibold group-hover:text-blue">
                              {it.name} <span aria-hidden="true" className="text-smile-ink transition-transform group-hover:translate-x-1">→</span>
                            </span>
                            <span className="mt-0.5 block text-sm text-slate">{it.note}</span>
                          </Link>
                        ) : (
                          <div className="py-4">
                            <span className="block font-semibold">{it.name}</span>
                            <span className="mt-0.5 block text-sm text-slate">{it.note}</span>
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Dijital iş akışı (gerçek bir sıra → numaralı) */}
        <section id="teknoloji" aria-labelledby="teknoloji-baslik" className="scroll-mt-6 bg-white">
          <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
            <h2 id="teknoloji-baslik" className="display text-4xl font-semibold text-navy">
              {d.tech.title}
            </h2>
            <p className="mt-3 max-w-2xl text-lg text-slate">{d.tech.lead}</p>
            <ol className="mt-12 grid gap-8 md:grid-cols-4">
              {d.tech.steps.map((s, i) => (
                <li key={s.name} className="relative">
                  <span className="display num text-5xl font-semibold text-smile" aria-hidden="true">
                    {i + 1}
                  </span>
                  <h3 className="display mt-2 text-xl font-semibold text-navy">{s.name}</h3>
                  <p className="mt-2 text-slate">{s.text}</p>
                </li>
              ))}
            </ol>
            {techPages.length > 0 && (
              <ul className="mt-12 grid gap-4 md:grid-cols-3">
                {techPages.map((p) => (
                  <li key={p.id}>
                    <Link href={`/${locale}/${p.slug}`} className="group block h-full rounded-2xl border border-gypsum p-6 hover:border-navy">
                      <span className="display block text-xl font-semibold text-navy">{t(p.title, locale)}</span>
                      <span className="mt-1 block text-sm text-slate">{t(p.summary, locale)}</span>
                      <span className="mt-3 block text-sm font-semibold text-smile-ink group-hover:underline">{PAGE_UI[locale].more} →</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-14 rounded-2xl bg-porcelain p-6">
              <h3 className="font-semibold text-navy">{d.tech.materials}</h3>
              <ul className="mt-3 flex flex-wrap gap-2">
                {d.tech.materialList.map((m) => (
                  <li key={m} className="rounded-full border border-gypsum bg-white px-3 py-1 text-sm">
                    {m}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {/* Teslimat takvimi (Fransa ↔ İzmir, UPS) */}
        <section id="teslimat" aria-labelledby="teslimat-baslik" className="scroll-mt-6">
          <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
            <h2 id="teslimat-baslik" className="display text-4xl font-semibold text-navy">
              {d.delivery.title}
            </h2>
            <p className="mt-3 max-w-2xl text-lg text-slate">{d.delivery.lead}</p>
            <div className="mt-10 overflow-x-auto rounded-2xl border border-gypsum bg-white">
              <table className="w-full min-w-[560px] text-left">
                <thead className="bg-navy text-sm text-white">
                  <tr>
                    {d.delivery.cols.map((c) => (
                      <th key={c} scope="col" className="px-5 py-3 font-semibold">
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {d.delivery.rows.map((r) => (
                    <tr key={r[0]} className="border-t border-gypsum">
                      {r.map((c, i) => (
                        <td key={i} className={`px-5 py-3 ${i === 0 ? "font-semibold" : "text-slate"}`}>
                          {c}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-sm text-slate">{d.delivery.note}</p>
          </div>
        </section>

        {/* Kalite */}
        <section id="kalite" aria-labelledby="kalite-baslik" className="scroll-mt-6 bg-white">
          <div className="mx-auto grid max-w-6xl gap-10 px-4 py-20 sm:px-6 md:grid-cols-[1fr_1.2fr]">
            <div>
              <h2 id="kalite-baslik" className="display text-4xl font-semibold text-navy">
                {d.quality.title}
              </h2>
              <p className="mt-3 text-lg text-slate">{d.quality.text}</p>
              {qualityPages.map((p) => (
                <Link key={p.id} href={`/${locale}/${p.slug}`} className="mt-5 mr-4 inline-block font-semibold text-smile-ink hover:underline">
                  {t(p.title, locale)} →
                </Link>
              ))}
            </div>
            <ul className="grid gap-4 sm:grid-cols-2">
              {d.quality.standards.map((s) => (
                <li key={s.code} className="rounded-2xl border-2 border-navy p-6">
                  <p className="display num text-2xl font-semibold text-navy">{s.code}</p>
                  <p className="mt-2 text-slate">{s.name}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Admin panelinden yayınlanan haber türü duyurular */}
        {news.length > 0 && (
          <section aria-labelledby="duyurular" className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
            <h2 id="duyurular" className="display text-4xl font-semibold text-navy">
              {NEWS_TITLE[locale]}
            </h2>
            <ul className="mt-8 divide-y divide-gypsum border-y border-gypsum">
              {news.map((n) => (
                <li key={n.id} className="py-6">
                  <h3 className="display text-xl font-semibold text-navy">{t(n.title, locale)}</h3>
                  <p className="mt-2 max-w-3xl whitespace-pre-line text-slate">{t(n.body, locale)}</p>
                  {n.link_href && (
                    <a href={n.link_href} className="mt-2 inline-block font-semibold text-smile-ink underline-offset-4 hover:underline">
                      {n.link_href.replace(/^https?:\/\//, "")}
                    </a>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>

      <SiteFooter locale={locale} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(orgLd).replace(/</g, "\\u003c") }} />
    </>
  );
}
