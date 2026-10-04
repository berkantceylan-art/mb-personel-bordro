import type { MetadataRoute } from "next";
import { LOCALES } from "@/lib/i18n";

export default function sitemap(): MetadataRoute.Sitemap {
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? "https://mbdentaire.com";
  const paths = ["", "/vaka-gonder"];
  return paths.flatMap((p) =>
    LOCALES.map((l) => ({
      url: `${site}/${l}${p}`,
      changeFrequency: "weekly" as const,
      priority: p === "" ? 1 : 0.6,
      alternates: { languages: Object.fromEntries(LOCALES.map((x) => [x, `${site}/${x}${p}`])) },
    })),
  );
}
