import type { Metadata } from "next";
import "../globals.css";

export const metadata: Metadata = {
  title: { default: "MB Dental", template: "%s · MB Dental" },
  robots: { index: false, follow: false },
  icons: { icon: "/favicon.ico", apple: "/apple-touch-icon.png" },
};

export default function PanelLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="tr">
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
