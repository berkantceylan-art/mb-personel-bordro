import type { Metadata } from "next";
import "../globals.css";
import { portalContext, portalLocale } from "@/lib/portal";

export const metadata: Metadata = {
  title: { default: "MB Dental — Portal", template: "%s — MB Dental" },
  robots: { index: false, follow: false },
  icons: { icon: "/favicon.ico", apple: "/apple-touch-icon.png" },
};

export default async function PortalRoot({ children }: { children: React.ReactNode }) {
  const ctx = await portalContext();
  const lang = await portalLocale(ctx?.account);
  return (
    <html lang={lang}>
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
