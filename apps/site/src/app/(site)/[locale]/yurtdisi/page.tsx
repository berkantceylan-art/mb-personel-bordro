import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SiteFooter, SiteHeader } from "@/components/SiteChrome";
import { publicProducts } from "@/lib/cms";
import { LOCALES, isLocale, t, type Locale } from "@/lib/i18n";
import { ldScript, siteUrl } from "@/lib/seo";

export const revalidate = 600;
type Params = Promise<{ locale: string }>;

const C: Record<Locale, { meta: string; desc: string; kicker: string; h1: string; lead: string; cta: string; cta2: string; whyTitle: string; why: [string, string][]; howTitle: string; how: [string, string][]; leadTitle: string; leadText: string; leadLink: string; days: string; priceTitle: string; priceText: string; finalTitle: string; finalText: string }> = {
  tr: {
    meta: "Yurt dışındaki hekimler için diş laboratuvarı — MB Dental İzmir",
    desc: "Avrupa'daki hekim ve klinikler için İzmir'den dijital diş laboratuvarı: portaldan vaka gönderimi, DHL/UPS ile kargo, € fiyat, MDR uygunluk beyanı.",
    kicker: "Yurt dışındaki hekimler için",
    h1: "İzmir'deki dijital laboratuvarınız",
    lead: "Taramanızı ya da ölçünüzü gönderin; tasarımdan teslime her aşamayı kendi dilinizde portaldan izleyin.",
    cta: "Portal hesabı açın",
    cta2: "Teslim süresini hesaplayın",
    whyTitle: "Neden MB Dental?",
    why: [["Dijital iş akışı", "STL / PLY taramalarınızı portala yükleyin; CAD tasarım ve CAM üretim tek çatı altında."], ["Kargo ve takip", "Paketlerinizi DHL ya da UPS ile gönderin, takip numarasını portala yazın; geldiğinde bildirim alın."], ["Belgeler hazır", "Her ısmarlama cihaz için AB 2017/745 Ek XIII uygunluk beyanı ve aylık proforma portalda."], ["€ ile çalışma", "Euro fiyat listesi (hesabınız onaylanınca), ekstre ve banka bilgileri portalda."]],
    howTitle: "Nasıl çalışır?",
    how: [["Hesap açın", "Portal başvurunuz onaylanınca vaka göndermeye başlarsınız."], ["Vakayı gönderin", "Dijital dosyaları yükleyin ya da ölçüyü kargolayıp takip numarasını girin."], ["Aşama aşama izleyin", "Tasarım, üretim, kalite kontrol ve kargo durumunu portaldan görün, laboratuvarla mesajlaşın."], ["Teslim alın", "İşiniz uygunluk beyanıyla birlikte kargoya verilir."]],
    leadTitle: "Üretim süreleri",
    leadText: "Ürünlere göre laboratuvarda geçen iş günü (kargo hariç):",
    leadLink: "Tarihli hesaplama için teslim süresi hesaplayıcı",
    days: "iş günü",
    priceTitle: "Fiyatlar",
    priceText: "Güncel € fiyat listemizi portal hesabınız onaylandıktan sonra görebilirsiniz.",
    finalTitle: "İlk vakanızı göndermeye hazır mısınız?",
    finalText: "Başvuru birkaç dakika sürer; onaydan sonra hesabınıza ekibinizi de ekleyebilirsiniz.",
  },
  en: {
    meta: "Dental laboratory for dentists abroad — MB Dental Izmir",
    desc: "Digital dental lab in Izmir for dentists and clinics in Europe: online case submission, DHL/UPS shipping, prices in euros, MDR declarations of conformity.",
    kicker: "For dentists outside Turkey",
    h1: "Your digital dental lab in Izmir",
    lead: "Send your scan or impression and follow every stage, from design to delivery, in our portal — in your language.",
    cta: "Open a portal account",
    cta2: "Estimate turnaround",
    whyTitle: "Why MB Dental?",
    why: [["Digital workflow", "Upload STL / PLY scans to the portal; CAD design and CAM production under one roof."], ["Shipping & tracking", "Send parcels with DHL or UPS, enter the tracking number in the portal and get notified on arrival."], ["Documents included", "A declaration for custom-made devices (Annex XIII, Regulation (EU) 2017/745) for every case and a monthly pro forma in the portal."], ["Work in euros", "Euro price list (once your account is approved), statement and bank details in the portal."]],
    howTitle: "How it works",
    how: [["Open an account", "Once your portal application is approved you can start sending cases."], ["Send the case", "Upload digital files or ship the impression and enter the tracking number."], ["Follow every stage", "See design, production, quality control and shipping status, and message the lab."], ["Receive your work", "Your restoration ships with its declaration of conformity."]],
    leadTitle: "Production times",
    leadText: "Working days spent in the lab per product (shipping not included):",
    leadLink: "Dated estimate in the turnaround calculator",
    days: "working days",
    priceTitle: "Prices",
    priceText: "Our current euro price list is available in the portal once your account is approved.",
    finalTitle: "Ready to send your first case?",
    finalText: "Applying takes a few minutes; once approved you can add your team to the account.",
  },
  fr: {
    meta: "Laboratoire de prothèse dentaire en Turquie pour praticiens — MB Dental Izmir",
    desc: "Laboratoire dentaire numérique à Izmir pour praticiens et cabinets en Europe : envoi des cas en ligne, expédition DHL/UPS, prix en euros, déclarations de conformité MDR.",
    kicker: "Pour les praticiens hors de Turquie",
    h1: "Votre laboratoire numérique à Izmir",
    lead: "Envoyez votre empreinte numérique ou physique et suivez chaque étape, de la conception à la livraison, dans notre portail en français.",
    cta: "Ouvrir un compte",
    cta2: "Estimer le délai",
    whyTitle: "Pourquoi MB Dental ?",
    why: [["Flux numérique", "Téléversez vos fichiers STL / PLY dans le portail ; conception CAO et fabrication FAO sous le même toit."], ["Expédition et suivi", "Envoyez vos colis par DHL ou UPS, saisissez le numéro de suivi dans le portail et soyez averti à la réception."], ["Documents fournis", "Déclaration pour dispositif sur mesure (annexe XIII du règlement (UE) 2017/745) pour chaque cas et proforma mensuelle dans le portail."], ["En euros", "Liste de prix en euros (après validation du compte), relevé et coordonnées bancaires dans le portail."]],
    howTitle: "Comment ça marche ?",
    how: [["Ouvrez un compte", "Dès validation de votre demande, vous pouvez envoyer vos cas."], ["Envoyez le cas", "Téléversez les fichiers numériques ou expédiez l’empreinte et saisissez le numéro de suivi."], ["Suivez chaque étape", "Conception, fabrication, contrôle qualité et expédition : tout est visible, et vous échangez avec le laboratoire."], ["Recevez votre travail", "La prothèse est expédiée avec sa déclaration de conformité."]],
    leadTitle: "Délais de fabrication",
    leadText: "Jours ouvrés passés au laboratoire par produit (hors transport) :",
    leadLink: "Estimation datée avec le calculateur de délai",
    days: "jours ouvrés",
    priceTitle: "Tarifs",
    priceText: "Notre liste de prix en euros est consultable dans le portail après validation de votre compte.",
    finalTitle: "Prêt à envoyer votre premier cas ?",
    finalText: "La demande prend quelques minutes ; après validation, vous pouvez ajouter votre équipe au compte.",
  },
};

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const c = C[locale];
  return { title: c.meta, description: c.desc, alternates: { canonical: `/${locale}/yurtdisi`, languages: Object.fromEntries(LOCALES.map((l) => [l, `/${l}/yurtdisi`])) } };
}

/** Yurt dışındaki hekimler için kampanya / açılış sayfası (Google Ads ve paylaşımlar için) */
export default async function AbroadPage({ params }: { params: Params }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const c = C[locale];
  const leads = (await publicProducts()).filter((p) => p.lead_days != null).slice(0, 8);
  const faq = {
    "@context": "https://schema.org",
    "@type": "Service",
    serviceType: "Dental laboratory",
    provider: { "@type": "MedicalBusiness", name: "MB Dental", url: siteUrl() },
    areaServed: ["FR", "BE", "CH", "DE", "NL", "GB", "EU"],
    description: c.desc,
  };
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: ldScript(faq) }} />
      <SiteHeader locale={locale} altPath="/yurtdisi" />
      <main>
        <section className="bg-navy text-white">
          <div className="mx-auto max-w-6xl px-4 pb-20 pt-10 sm:px-6">
            <p className="text-sm font-semibold uppercase tracking-wider text-smile">{c.kicker}</p>
            <h1 className="display mt-4 max-w-3xl text-5xl font-semibold leading-[1.02] tracking-tight sm:text-6xl">{c.h1}</h1>
            <p className="mt-5 max-w-2xl text-xl text-white/80">{c.lead}</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href={`/portal/kayit?dil=${locale}`} className="rounded-full bg-smile px-6 py-3.5 font-semibold text-navy hover:bg-white">{c.cta}</Link>
              <Link href={`/${locale}/teslim-suresi`} className="rounded-full border border-white/30 px-6 py-3.5 font-semibold hover:border-white">{c.cta2}</Link>
            </div>
          </div>
        </section>
        <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <h2 className="display text-3xl font-semibold text-navy">{c.whyTitle}</h2>
          <ul className="mt-8 grid gap-5 md:grid-cols-2">
            {c.why.map(([h, p]) => (
              <li key={h} className="rounded-3xl bg-white p-7">
                <h3 className="display text-xl font-semibold text-navy">{h}</h3>
                <p className="mt-2 text-slate">{p}</p>
              </li>
            ))}
          </ul>
        </section>
        <section className="bg-white">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
            <h2 className="display text-3xl font-semibold text-navy">{c.howTitle}</h2>
            <ol className="mt-8 grid gap-5 md:grid-cols-4">
              {c.how.map(([h, p], i) => (
                <li key={h} className="rounded-3xl bg-porcelain p-6">
                  <span className="num display text-4xl font-semibold text-smile">{i + 1}</span>
                  <h3 className="mt-2 font-semibold text-navy">{h}</h3>
                  <p className="mt-1 text-sm text-slate">{p}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>
        <section className="mx-auto grid max-w-6xl gap-8 px-4 py-16 sm:px-6 lg:grid-cols-2">
          {leads.length > 0 && (
            <div className="rounded-3xl bg-white p-7">
              <h2 className="display text-2xl font-semibold text-navy">{c.leadTitle}</h2>
              <p className="mt-1 text-slate">{c.leadText}</p>
              <ul className="mt-4 divide-y divide-gypsum">
                {leads.map((p) => (
                  <li key={p.id} className="flex justify-between gap-3 py-2.5"><span>{t(p.name, locale)}</span><span className="num font-semibold text-navy">{p.lead_days} {c.days}</span></li>
                ))}
              </ul>
              <Link href={`/${locale}/teslim-suresi`} className="mt-4 inline-block text-sm font-semibold text-smile-ink hover:underline">{c.leadLink} →</Link>
            </div>
          )}
          <div className="rounded-3xl bg-white p-7">
            <h2 className="display text-2xl font-semibold text-navy">{c.priceTitle}</h2>
            <p className="mt-2 text-slate">{c.priceText}</p>
            <Link href={`/portal/kayit?dil=${locale}`} className="mt-5 inline-block rounded-full bg-navy px-6 py-3 font-semibold text-white hover:bg-blue">{c.cta}</Link>
          </div>
        </section>
        <section className="bg-navy text-white">
          <div className="mx-auto max-w-4xl px-4 py-16 text-center sm:px-6">
            <h2 className="display text-3xl font-semibold">{c.finalTitle}</h2>
            <p className="mt-3 text-white/75">{c.finalText}</p>
            <Link href={`/portal/kayit?dil=${locale}`} className="mt-6 inline-block rounded-full bg-smile px-7 py-3.5 font-semibold text-navy hover:bg-white">{c.cta}</Link>
          </div>
        </section>
      </main>
      <SiteFooter locale={locale} />
    </>
  );
}
