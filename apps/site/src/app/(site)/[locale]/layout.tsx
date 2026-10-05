import type { Metadata } from "next";
import { notFound } from "next/navigation";
import "../../globals.css";
import { DICTS, LOCALES, isLocale, t } from "@/lib/i18n";
import { getSettings } from "@/lib/settings";

export function generateStaticParams() {
  return LOCALES.map((locale) => ({ locale }));
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const d = DICTS[locale];
  const st = await getSettings();
  const title = t(st.seo_title, locale) || d.meta.title;
  const description = t(st.seo_description, locale) || d.meta.description;
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? "https://mbdentaire.com";
  return {
    metadataBase: new URL(site),
    title,
    description,
    alternates: {
      canonical: `/${locale}`,
      languages: Object.fromEntries(LOCALES.map((l) => [l, `/${l}`])),
    },
    openGraph: { title, description, siteName: "MB Dental", locale, type: "website" },
    twitter: { card: "summary_large_image", title, description },
    verification: st.google_verification ? { google: st.google_verification } : undefined,
    robots: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1 },
    formatDetection: { telephone: false },
    icons: { icon: "/favicon.ico", apple: "/apple-touch-icon.png" },
  };
}

export default async function LocaleLayout({ children, params }: { children: React.ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return (
    <html lang={locale}>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,600;12..96,700&family=Figtree:wght@400;500;600&display=swap"
        />
        <meta name="theme-color" content="#072A50" />
      </head>
      <body>{children}</body>
    </html>
  );
}
