import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? "https://mbdentaire.com";
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/admin", "/giris", "/api", "/auth", "/portal"] }],
    sitemap: `${site}/sitemap.xml`,
  };
}
