import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Lightbox } from "@/components/Lightbox";
import { SiteFooter, SiteHeader } from "@/components/SiteChrome";
import { mediaUrl, publicDepartments, publicTeam, type TeamMember } from "@/lib/cms";
import { LOCALES, isLocale, t, type Locale } from "@/lib/i18n";

export const revalidate = 300;

const TEAM_COPY: Record<Locale, { title: string; nav: string; lead: string; departments: string; departmentsLead: string; people: string; peopleLead: string; other: string; gallery: { close: string; prev: string; next: string; open: string }; home: string }> = {
  tr: {
    title: "Ekibimiz",
    nav: "Ekibimiz",
    lead: "Tasarımdan üretime, porselenden kalite kontrole: her vaka uzman ellerden geçer.",
    departments: "Departmanlarımız",
    departmentsLead: "Laboratuvarımız, her biri kendi alanında uzman bölümlerden oluşur.",
    people: "Çalışanlarımız",
    peopleLead: "Vakalarınızın arkasındaki insanlar.",
    other: "Ekip",
    gallery: { close: "Kapat", prev: "Önceki", next: "Sonraki", open: "Fotoğrafı büyüt" },
    home: "Anasayfa",
  },
  en: {
    title: "Our team",
    nav: "Team",
    lead: "From design to production, ceramics to quality control: every case passes through expert hands.",
    departments: "Our departments",
    departmentsLead: "Our laboratory is made up of departments, each expert in its own field.",
    people: "Our people",
    peopleLead: "The people behind your cases.",
    other: "Team",
    gallery: { close: "Close", prev: "Previous", next: "Next", open: "Enlarge photo" },
    home: "Home",
  },
  fr: {
    title: "Notre équipe",
    nav: "Équipe",
    lead: "De la conception à la production, de la céramique au contrôle qualité : chaque cas passe entre des mains expertes.",
    departments: "Nos départements",
    departmentsLead: "Notre laboratoire réunit des départements, chacun expert dans son domaine.",
    people: "Nos collaborateurs",
    peopleLead: "Les personnes derrière vos cas.",
    other: "Équipe",
    gallery: { close: "Fermer", prev: "Précédent", next: "Suivant", open: "Agrandir la photo" },
    home: "Accueil",
  },
};

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const c = TEAM_COPY[locale];
  return {
    title: `${c.title} — MB Dental`,
    description: c.lead,
    alternates: { canonical: `/${locale}/ekibimiz`, languages: Object.fromEntries(LOCALES.map((l) => [l, `/${l}/ekibimiz`])) },
    openGraph: { title: c.title, description: c.lead, siteName: "MB Dental", locale },
  };
}

function Person({ m, locale }: { m: TeamMember; locale: Locale }) {
  const photo = mediaUrl(m.photo_path);
  const role = t(m.role, locale);
  const bio = t(m.bio, locale);
  return (
    <article className="group">
      <div className="aspect-[4/5] overflow-hidden rounded-3xl bg-gypsum">
        {photo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photo} alt={m.name} loading="lazy" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]" />
        ) : (
          <div aria-hidden="true" className="grid h-full w-full place-items-center bg-[radial-gradient(circle_at_30%_20%,rgba(43,196,238,.25),transparent_60%)] text-5xl font-semibold text-navy/40">
            {m.name
              .split(/\s+/)
              .map((x) => x[0])
              .slice(0, 2)
              .join("")
              .toLocaleUpperCase(locale)}
          </div>
        )}
      </div>
      <h3 className="mt-4 text-lg font-semibold text-ink">{m.name}</h3>
      {role && <p className="text-sm text-slate">{role}</p>}
      {bio && <p className="mt-2 text-sm leading-relaxed text-slate">{bio}</p>}
      {m.linkedin && (
        <a href={m.linkedin} target="_blank" rel="noreferrer" className="mt-2 inline-block text-sm font-semibold text-smile-ink hover:underline">
          LinkedIn ↗
        </a>
      )}
    </article>
  );
}

export default async function TeamPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const c = TEAM_COPY[locale];
  const [departments, team] = await Promise.all([publicDepartments(), publicTeam()]);
  const known = new Set(departments.map((d) => d.id));
  const groups = [
    ...departments.map((d) => ({ id: d.id, label: t(d.name, locale), people: team.filter((m) => m.department_id === d.id) })),
    { id: "diger", label: c.other, people: team.filter((m) => !m.department_id || !known.has(m.department_id)) },
  ].filter((g) => g.people.length);
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? "https://mbdentaire.com";
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: c.home, item: `${site}/${locale}` },
      { "@type": "ListItem", position: 2, name: c.title, item: `${site}/${locale}/ekibimiz` },
    ],
  };

  return (
    <>
      <SiteHeader locale={locale} altPath="/ekibimiz" current="team" />
      <main>
        <section className="bg-navy text-white">
          <div className="mx-auto max-w-6xl px-4 pb-16 pt-8 sm:px-6">
            <h1 className="display text-5xl font-semibold sm:text-7xl">{c.title}</h1>
            <p className="mt-5 max-w-2xl text-xl text-white/75">{c.lead}</p>
            <nav className="mt-8 flex flex-wrap gap-2 text-sm">
              {departments.length > 0 && (
                <a href="#departmanlar" className="rounded-full border border-white/25 px-4 py-1.5 hover:border-white">
                  {c.departments}
                </a>
              )}
              {groups.length > 0 && (
                <a href="#calisanlar" className="rounded-full border border-white/25 px-4 py-1.5 hover:border-white">
                  {c.people}
                </a>
              )}
            </nav>
          </div>
        </section>

        {departments.length > 0 && (
          <section id="departmanlar" aria-labelledby="dep-baslik" className="scroll-mt-20">
            <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
              <h2 id="dep-baslik" className="display text-3xl font-semibold text-navy sm:text-4xl">
                {c.departments}
              </h2>
              <p className="mt-2 max-w-2xl text-slate">{c.departmentsLead}</p>
              <ul className="mt-10 grid gap-8 md:grid-cols-2">
                {departments.map((d, i) => {
                  const img = mediaUrl(d.image_path);
                  const gallery = d.gallery.map((g) => mediaUrl(g)).filter((u): u is string => !!u);
                  return (
                    <li key={d.id} className="reveal overflow-hidden rounded-3xl border border-gypsum bg-white">
                      <div className="relative aspect-[16/10] overflow-hidden bg-navy">
                        {img ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={img} alt={t(d.name, locale)} loading="lazy" className="h-full w-full object-cover" />
                        ) : (
                          <div aria-hidden="true" className="dept-pattern h-full w-full" />
                        )}
                        <span className="absolute left-5 top-5 rounded-full bg-white/90 px-3 py-1 text-xs font-bold tabular-nums text-navy">{String(i + 1).padStart(2, "0")}</span>
                      </div>
                      <div className="p-6 sm:p-7">
                        <h3 className="display text-2xl font-semibold text-navy">{t(d.name, locale)}</h3>
                        {t(d.description, locale) && <p className="mt-2 leading-relaxed text-slate">{t(d.description, locale)}</p>}
                        <Lightbox images={gallery} alt={t(d.name, locale)} labels={c.gallery} />
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          </section>
        )}

        {groups.length > 0 && (
          <section id="calisanlar" aria-labelledby="ekip-baslik" className="scroll-mt-20 border-t border-gypsum bg-white">
            <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
              <h2 id="ekip-baslik" className="display text-3xl font-semibold text-navy sm:text-4xl">
                {c.people}
              </h2>
              <p className="mt-2 text-slate">{c.peopleLead}</p>
              <div className="mt-10 grid gap-14">
                {groups.map((g) => (
                  <div key={g.id}>
                    {groups.length > 1 && <h3 className="mb-5 text-sm font-semibold uppercase tracking-wider text-smile-ink">{g.label}</h3>}
                    <ul className="grid grid-cols-2 gap-x-5 gap-y-10 md:grid-cols-3 lg:grid-cols-4">
                      {g.people.map((m) => (
                        <li key={m.id} className="reveal">
                          <Person m={m} locale={locale} />
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}
      </main>
      <SiteFooter locale={locale} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
    </>
  );
}
