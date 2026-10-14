import { publicAreas, publicFaqs, publicPages, publicPosts, publicProducts } from "@/lib/cms";
import { DICTS, t } from "@/lib/i18n";
import { siteUrl } from "@/lib/seo";
import { getSettings } from "@/lib/settings";

export const revalidate = 3600;

/** Yapay zekâ arama motorları için özet (llms.txt önerisi) */
export async function GET() {
  const site = siteUrl();
  const [products, pages, st, areas, faqs, posts] = await Promise.all([publicProducts(), publicPages(), getSettings(), publicAreas(), publicFaqs(), publicPosts(30)]);
  const lines = [
    "# MB Dental",
    "",
    `> ${DICTS.en.meta.description}`,
    "",
    `Dental laboratory in ${st.address2 || "İzmir, Türkiye"}. Works with dentists, clinics and agencies in Türkiye and abroad. Languages: Turkish, English, French.`,
    `Contact: ${st.phone} · ${st.email}`,
    "",
    "## Products",
    ...products.map((p) => `- [${t(p.name, "en")}](${site}/en/urunler/${p.slug}): ${t(p.summary, "en")}`),
    "",
    "## Company",
    ...pages.map((p) => `- [${t(p.title, "en")}](${site}/en/${p.slug})`),
    `- [Team and departments](${site}/en/ekibimiz)`,
    `- [FAQ](${site}/en/sss)`,
    `- [Case gallery](${site}/en/vakalar)`,
    `- [Contact](${site}/en/iletisim)`,
    "",
    "## Areas served",
    ...areas.map((a) => `- [${t(a.name, "en")}](${site}/en/bolge/${a.slug})${a.shipping_days !== null ? `: delivery about ${a.shipping_days} working days` : ""}`),
    "",
    "## Key facts (FAQ)",
    ...faqs.slice(0, 25).map((f) => `- ${t(f.question, "en")} — ${t(f.answer, "en").replace(/\s+/g, " ").slice(0, 280)}`),
    "",
    ...(posts.length ? ["## Articles", ...posts.map((p) => `- [${t(p.title, "en") || t(p.title, "tr")}](${site}/${p.title?.en ? "en" : "tr"}/blog/${p.slug})`), ""] : []),
    "## Full text",
    `- [llms-full.txt](${site}/llms-full.txt): product descriptions and all FAQ answers in one file`,
    `- [Lead times](${site}/en/teslim-suresi)`,
    `- [Working with us from abroad](${site}/en/yurtdisi)`,
    "",
    "## For doctors",
    `- [Send a case](${site}/en/vaka-gonder)`,
    `- [Doctor portal](${site}/portal)`,
    "",
  ];
  return new Response(lines.join("\n"), { headers: { "content-type": "text/plain; charset=utf-8" } });
}
