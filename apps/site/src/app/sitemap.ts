import type { MetadataRoute } from "next";
import { publicAreas, publicPages, publicPosts, publicProducts } from "@/lib/cms";
import { LOCALES } from "@/lib/i18n";

export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? "https://mbdentaire.com";
  const [products, sitePages, posts, areas] = await Promise.all([publicProducts(), publicPages(), publicPosts(500), publicAreas()]);
  const pages: { path: string; priority: number }[] = [
    { path: "", priority: 1 },
    { path: "/urunler", priority: 0.8 },
    { path: "/vaka-gonder", priority: 0.6 },
    { path: "/iletisim", priority: 0.6 },
    { path: "/vakalar", priority: 0.6 },
    { path: "/sss", priority: 0.5 },
    { path: "/ekibimiz", priority: 0.5 },
    { path: "/blog", priority: 0.7 },
    { path: "/teslim-suresi", priority: 0.5 },
    { path: "/kariyer", priority: 0.4 },
    { path: "/yurtdisi", priority: 0.8 },
    ...sitePages.map((p) => ({ path: `/${p.slug}`, priority: 0.6 })),
    ...products.map((p) => ({ path: `/urunler/${p.slug}`, priority: 0.7 })),
    { path: "/bolge", priority: 0.6 },
    ...areas.map((a) => ({ path: `/bolge/${a.slug}`, priority: 0.6 })),
  ];
  const postEntries = posts.flatMap((p) => {
    const langs = LOCALES.filter((l) => p.title?.[l]);
    return langs.map((l) => ({
      url: `${site}/${l}/blog/${p.slug}`,
      lastModified: p.updated_at,
      changeFrequency: "monthly" as const,
      priority: 0.6,
      alternates: { languages: Object.fromEntries(langs.map((x) => [x, `${site}/${x}/blog/${p.slug}`])) },
    }));
  });
  return [...postEntries, ...pages.flatMap(({ path, priority }) =>
    LOCALES.map((l) => ({
      url: `${site}/${l}${path}`,
      changeFrequency: "weekly" as const,
      priority,
      alternates: { languages: Object.fromEntries(LOCALES.map((x) => [x, `${site}/${x}${path}`])) },
    })),
  )];
}