import { publicPages, publicProducts } from "@/lib/cms";
import { DICTS, t } from "@/lib/i18n";
import { siteUrl } from "@/lib/seo";
import { getSettings } from "@/lib/settings";

export const revalidate = 3600;

/** Yapay zekâ arama motorları için özet (llms.txt önerisi) */
export async function GET() {
  const site = siteUrl();
  const [products, pages, st] = await Promise.all([publicProducts(), publicPages(), getSettings()]);
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
    "## For doctors",
    `- [Send a case](${site}/en/vaka-gonder)`,
    `- [Doctor portal](${site}/portal)`,
    "",
  ];
  return new Response(lines.join("\n"), { headers: { "content-type": "text/plain; charset=utf-8" } });
}
