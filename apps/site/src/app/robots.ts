import type { MetadataRoute } from "next";

/** Arama motorları ve yapay zekâ botları siteyi okuyabilir; yönetim, portal ve giriş sayfaları kapalı */
export default function robots(): MetadataRoute.Robots {
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? "https://mbdentaire.com";
  const disallow = ["/admin", "/giris", "/api", "/auth", "/portal"];
  const ai = ["GPTBot", "OAI-SearchBot", "ChatGPT-User", "ClaudeBot", "Claude-User", "Claude-SearchBot", "PerplexityBot", "Perplexity-User", "Google-Extended", "Applebot-Extended", "Bingbot", "DuckAssistBot", "MistralAI-User", "Meta-ExternalAgent"];
  return {
    rules: [{ userAgent: "*", allow: "/", disallow }, { userAgent: ai, allow: ["/", "/llms.txt", "/llms-full.txt"], disallow }],
    sitemap: `${site}/sitemap.xml`,
  };
}
