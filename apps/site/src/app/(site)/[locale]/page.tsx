import Link from "next/link";
import { notFound } from "next/navigation";
import { AnnouncementBar, SiteFooter, SiteHeader } from "@/components/SiteChrome";
import { ToothChart } from "@/components/ToothChart";
import { CaseCard } from "@/components/CaseCard";
import { Popup } from "@/components/Popup";
import { CountUp } from "@/components/CountUp";
import { Stories } from "@/components/Stories";
import { PRODUCT_CATEGORIES, mediaUrl, publicAnnouncements, publicCases, publicPages, publicProducts, publicSlides, publicDepartments } from "@/lib/cms";
import { mediaKind } from "@/lib/media";
import { businessJsonLd } from "@/lib/seo";
import { STORY_LABELS, instagramPosts, storyViews } from "@/lib/stories";
import { getSettings, telHref } from "@/lib/settings";
import { CASE_UI, DICTS, PAGE_UI, PRODUCT_UI, isLocale, t, type Locale } from "@/lib/i18n";

export const revalidate = 60;

const TOOTH_WORD: Record<Locale, string> = { tr: "Diş", en: "Tooth", fr: "Dent" };
const POPUP_LABELS: Record<Locale, { more: string; close: string }> = {
  tr: { more: "Ayrıntılar", close: "Kapat" },
  en: { more: "Learn more", close: "Close" },
  fr: { more: "En savoir plus", close: "Fermer" },
};
const STATS_TITLE: Record<Locale, string> = { tr: "Rakamlarla MB Dental", en: "MB Dental in numbers", fr: "MB Dental en chiffres" };
const TEAM_TEASER: Record<Locale, { title: string; lead: string; more: string }> = {
  tr: { title: "Departmanlarımız", lead: "Tasarımdan kalite kontrole, her aşamada uzman bir ekip.", more: "Ekibimizi tanıyın" },
  en: { title: "Our departments", lead: "From design to quality control, an expert team at every stage.", more: "Meet the team" },
  fr: { title: "Nos départements", lead: "De la conception au contrôle qualité, une équipe experte à chaque étape.", more: "Découvrir l’équipe" },
};
const IG_TITLE: Record<Locale, string> = { tr: "Instagram'da MB Dental", en: "MB Dental on Instagram", fr: "MB Dental sur Instagram" };
const IG_FOLLOW: Record<Locale, string> = { tr: "Takip edin", en: "Follow", fr: "Suivre" };
const NEWS_TITLE: Record<Locale, string> = { tr: "Duyurular", en: "News", fr: "Actualités" };
export default async function Home({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const d = DICTS[locale];
  const [banners, news, slides, products, pages, featuredCases, popups, departments, igPosts] = await Promise.all([
    publicAnnouncements("banner"),
    publicAnnouncements("news"),
    publicSlides("home"),
    publicProducts(),
    publicPages(),
    publicCases({ featured: true }),
    publicAnnouncements("popup"),
    publicDepartments(),
    instagramPosts(8),
  ]);
  const productNames = Object.fromEntries(products.map((p) => [p.slug, t(p.name, locale)]));
  const popup = popups[0];
  const techPages = pages.filter((p) => p.group === "teknoloji");
  const qualityPages = pages.filter((p) => p.group === "kalite");
  const st = await getSettings();
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? "https://mbdentaire.com";
  // Arama motorları için kurum bilgisi
  const orgLd = businessJsonLd(st, locale);
  const stories = await storyViews(locale, st.social.instagram);
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

        {/* Malzeme ve ürün şeridi */}
        <div className="marquee border-b border-gypsum bg-white py-4" aria-hidden="true">
          <div className="marquee-track">
            {[0, 1].map((k) => (
              <ul key={k} className="flex shrink-0 items-center gap-10 pr-10">
                {[...d.tech.materialList, ...products.slice(0, 8).map((p) => t(p.name, locale))].map((m, x) => (
                  <li key={`${k}-${x}`} className="display flex items-center gap-10 whitespace-nowrap text-2xl font-semibold text-navy/80 sm:text-3xl">
                    {m}
                    <span className="h-2 w-2 rounded-full bg-smile" />
                  </li>
                ))}
              </ul>
            ))}
          </div>
        </div>

        {/* Rakamlarla MB Dental (Site ayarları) */}
        {st.stats.length > 0 && (
          <section aria-label={STATS_TITLE[locale]} className="relative overflow-hidden bg-navy text-white">
            <div aria-hidden="true" className="absolute inset-0 bg-[radial-gradient(60%_120%_at_90%_0%,rgba(43,196,238,.28),transparent_60%),radial-gradient(50%_100%_at_0%_100%,rgba(14,76,140,.9),transparent_60%)]" />
            <dl className={`relative mx-auto grid max-w-6xl gap-8 px-4 py-14 sm:px-6 ${st.stats.length >= 4 ? "grid-cols-2 lg:grid-cols-4" : st.stats.length === 3 ? "grid-cols-1 sm:grid-cols-3" : "grid-cols-2"}`}>
              {st.stats.map((x, i) => (
                <div key={i} className="reveal flex flex-col">
                  <dt className="mt-1 text-sm text-white/70 sm:text-base">{t(x.label, locale)}</dt>
                  <dd className="display order-first text-5xl font-semibold tracking-tight text-smile sm:text-6xl">
                    <CountUp value={x.value} />
                  </dd>
                </div>
              ))}
            </dl>
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

        {/* Öne çıkan vakalar */}
        {featuredCases.length > 0 && (
          <section aria-labelledby="vakalar-baslik" className="border-t border-gypsum">
            <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
              <div className="flex flex-wrap items-end justify-between gap-4">
                <h2 id="vakalar-baslik" className="display text-4xl font-semibold text-navy">
                  {CASE_UI[locale].home}
                </h2>
                <Link href={`/${locale}/vakalar`} className="font-semibold text-smile-ink hover:underline">
                  {CASE_UI[locale].all} →
                </Link>
              </div>
              <ul className="mt-10 grid gap-10 sm:grid-cols-2 lg:grid-cols-3">
                {featuredCases.slice(0, 3).map((c) => (
                  <li key={c.id}>
                    <CaseCard c={c} locale={locale} productName={c.product_slug ? productNames[c.product_slug] : undefined} />
                  </li>
                ))}
              </ul>
            </div>
          </section>
        )}

        {/* Dijital iş akışı (gerçek bir sıra → numaralı) */}
        <section id="teknoloji" aria-labelledby="teknoloji-baslik" className="scroll-mt-6 bg-white">
          <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
            <h2 id="teknoloji-baslik" className="display text-4xl font-semibold text-navy">
              {d.tech.title}
            </h2>
            <p className="mt-3 max-w-2xl text-lg text-slate">{d.tech.lead}</p>
            <ol className="mt-12 grid gap-8 md:grid-cols-4">
              {d.tech.steps.map((s, i) => (
                <li key={s.name} className="step reveal relative">
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
        {/* Ekibimiz: departmanlar */}
        {departments.length > 0 && (
          <section aria-labelledby="ekip-baslik" className="border-t border-gypsum bg-white">
            <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
              <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                  <h2 id="ekip-baslik" className="display text-4xl font-semibold text-navy">
                    {TEAM_TEASER[locale].title}
                  </h2>
                  <p className="mt-3 max-w-2xl text-lg text-slate">{TEAM_TEASER[locale].lead}</p>
                </div>
                <Link href={`/${locale}/ekibimiz`} className="rounded-full border border-gypsum px-5 py-2.5 font-semibold text-navy hover:border-navy">
                  {TEAM_TEASER[locale].more} →
                </Link>
              </div>
              <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {departments.slice(0, 4).map((dep, i) => {
                  const img = mediaUrl(dep.image_path);
                  return (
                    <li key={dep.id} className="reveal">
                      <Link href={`/${locale}/ekibimiz#departmanlar`} className="group relative block aspect-[3/4] overflow-hidden rounded-3xl bg-navy">
                        {img ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={img} alt="" loading="lazy" className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-105" />
                        ) : (
                          <span aria-hidden="true" className="dept-pattern block h-full w-full" />
                        )}
                        <span className="absolute inset-0 bg-gradient-to-t from-navy via-navy/30 to-transparent" />
                        <span className="absolute left-5 top-5 text-sm font-bold tabular-nums text-white/70">{String(i + 1).padStart(2, "0")}</span>
                        <span className="display absolute inset-x-5 bottom-5 text-xl font-semibold leading-tight text-white">{t(dep.name, locale)}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          </section>
        )}

        {/* Instagram (anahtar tanımlıysa) */}
        {igPosts.length > 0 && (
          <section aria-labelledby="ig-baslik" className="border-t border-gypsum">
            <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
              <div className="flex flex-wrap items-end justify-between gap-4">
                <h2 id="ig-baslik" className="display text-4xl font-semibold text-navy">
                  {IG_TITLE[locale]}
                </h2>
                {st.social.instagram && (
                  <a href={st.social.instagram} target="_blank" rel="noreferrer" className="rounded-full bg-navy px-5 py-2.5 font-semibold text-white hover:bg-blue">
                    {IG_FOLLOW[locale]} ↗
                  </a>
                )}
              </div>
              <ul className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
                {igPosts.map((p) => (
                  <li key={p.id}>
                    <a href={p.href} target="_blank" rel="noreferrer" className="group relative block aspect-square overflow-hidden rounded-2xl bg-gypsum" aria-label={p.caption || "Instagram"}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={p.image} alt="" loading="lazy" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" />
                      {p.video && <span aria-hidden="true" className="absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-full bg-white/85 text-[10px] text-navy">▶</span>}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          </section>
        )}
      </main>

      <SiteFooter locale={locale} />
      {popup && (t(popup.title, locale) || t(popup.body, locale)) && (
        <Popup
          id={popup.id}
          version={popup.updated_at}
          title={t(popup.title, locale)}
          body={t(popup.body, locale)}
          image={mediaUrl(popup.image_path)}
          link={popup.link_href ? { href: popup.link_href, label: POPUP_LABELS[locale].more } : null}
          closeLabel={POPUP_LABELS[locale].close}
        />
      )}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(orgLd).replace(/</g, "\\u003c") }} />
    </>
  );
}
