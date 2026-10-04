import type { MetadataRoute } from "next";
import { publicProducts } from "@/lib/cms";
import { LOCALES } from "@/lib/i18n";

export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? "https://mbdentaire.com";
  const products = await publicProducts();
  const pages: { path: string; priority: number }[] = [
    { path: "", priority: 1 },
    { path: "/urunler", priority: 0.8 },
    { path: "/vaka-gonder", priority: 0.6 },
    ...products.map((p) => ({ path: `/urunler/${p.slug}`, priority: 0.7 })),
  ];
  return pages.flatMap(({ path, priority }) =>
    LOCALES.map((l) => ({
      url: `${site}/${l}${path}`,
      changeFrequency: "weekly" as const,
      priority,
      alternates: { languages: Object.fromEntries(LOCALES.map((x) => [x, `${site}/${x}${path}`])) },
    })),
  );
}
