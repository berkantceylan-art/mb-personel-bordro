import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ServiceWorker } from "@/components/Pwa";

export const metadata: Metadata = {
  title: "MB Dental · Personel & Bordro",
  description: "Personel, puantaj, avans ve bordro yönetimi",
  applicationName: "MB Personel",
  appleWebApp: { capable: true, title: "MB Personel", statusBarStyle: "black-translucent" },
  icons: { icon: [{ url: "/logo.svg", type: "image/svg+xml" }, { url: "/icon-192.png", sizes: "192x192" }], apple: "/apple-touch-icon.png" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#072A50",
  viewportFit: "cover",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="tr">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Montserrat:wght@500;600;700&family=Public+Sans:wght@400;500;600;700&display=swap"
        />
      </head>
      <body className="antialiased">
        {children}
        <ServiceWorker />
      </body>
    </html>
  );
}
