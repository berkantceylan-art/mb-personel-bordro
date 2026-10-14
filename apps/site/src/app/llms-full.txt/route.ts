import { publicAreas, publicFaqs, publicProducts } from "@/lib/cms";
import { DICTS, t } from "@/lib/i18n";
import { siteUrl } from "@/lib/seo";
import { getSettings } from "@/lib/settings";

export const revalidate = 3600;

const plain = (s: string) => s.replace(/<[^>]+>/g, " ").replace(/[#*_`>]+/g, "").replace(/\n{3,}/g, "\n\n").trim();

/** Yapay zekâ için tam metin: ürün açıklamaları, soru-cevaplar, bölgeler (İngilizce, yoksa Türkçe) */
export async function GET() {
  const site = siteUrl();
  const [products, faqs, areas, st] = await Promise.all([publicProducts(), publicFaqs(), publicAreas(), getSettings()]);
  const en = (x: Record<string, string | null | undefined> | undefined) => t(x ?? {}, "en") || t(x ?? {}, "tr");
  const out = [
    "# MB Dental — full reference", "", `> ${DICTS.en.meta.description}`, "",
    `Dental laboratory, ${st.address1} ${st.address2}. Phone ${st.phone}, e-mail ${st.email}. Works with dentists, clinics and agencies in Türkiye and Europe. Digital cases (STL, intraoral scans) accepted through the doctor portal.`, "",
    "## Products", "",
    ...products.flatMap((p) => [`### ${en(p.name)}`, `URL: ${site}/en/urunler/${p.slug}`, en(p.summary), plain(en(p.body)), en(p.highlights) ? `Highlights: ${en(p.highlights).split("\n").filter(Boolean).join("; ")}` : "", ""]),
    "## Frequently asked questions", "",
    ...faqs.flatMap((f) => [`Q: ${en(f.question)}`, `A: ${plain(en(f.answer))}`, ""]),
    "## Areas served", "",
    ...areas.map((a) => `- ${en(a.name)} (${a.kind === "city" ? "Türkiye" : "international"})${a.shipping_days !== null ? `, delivery about ${a.shipping_days} working days` : ""}: ${site}/en/bolge/${a.slug}`),
    "",
  ];
  return new Response(out.filter((l, i, a) => !(l === "" && a[i - 1] === "")).join("\n"), { headers: { "content-type": "text/plain; charset=utf-8" } });
}
