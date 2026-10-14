import Link from "next/link";
import { PageHead } from "@/components/admin/ui";
import { LOCALES, t, type I18nText } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "SEO denetimi" };

type Issue = { where: string; href: string; edit: string; problems: string[]; score: number };
const len = (x: I18nText | null | undefined, l: string) => (x?.[l as keyof I18nText] ?? "").trim().length;

/** SEO ve yapay zekâ hazırlığı denetimi: eksik başlık / açıklama / çeviri / görsel / soru-cevap, bulunamayan sayfalar */
export default async function SeoAudit() {
  const supabase = await createClient();
  const [{ data: pr }, { data: pg }, { data: po }, { data: ar }, { data: fq }, { data: nf }] = await Promise.all([
    supabase.from("cms_products").select("id, slug, name, summary, body, seo_title, seo_description, image_path").is("deleted_at", null).eq("is_active", true),
    supabase.from("cms_pages").select("id, slug, title, body, seo_title, seo_description").is("deleted_at", null).eq("is_active", true),
    supabase.from("cms_posts").select("id, slug, title, summary, body, seo_title, seo_description, image_path").is("deleted_at", null).eq("is_active", true),
    supabase.from("cms_areas").select("id, slug, name, intro, body").is("deleted_at", null).eq("is_active", true),
    supabase.from("cms_faqs").select("product_slug, area_slug").is("deleted_at", null).eq("is_active", true),
    supabase.from("site_hits").select("path, at").eq("kind", "event").eq("name", "404").gte("at", new Date(Date.now() - 30 * 86400000).toISOString()).limit(3000),
  ]);
  const faqProducts = new Set(((fq ?? []) as Array<{ product_slug: string | null }>).map((f) => f.product_slug).filter(Boolean));
  const faqAreas = new Set(((fq ?? []) as Array<{ area_slug: string | null }>).map((f) => f.area_slug).filter(Boolean));
  const issues: Issue[] = [];
  const check = (where: string, href: string, edit: string, x: { title?: I18nText; name?: I18nText; summary?: I18nText; body?: I18nText; seo_title?: I18nText; seo_description?: I18nText; image_path?: string | null }, extra: string[] = []) => {
    const p: string[] = [...extra];
    const title = x.title ?? x.name;
    for (const l of LOCALES) if (!len(title, l)) p.push(`${l.toUpperCase()} başlık / ad yok`);
    if (x.seo_title !== undefined && !len(x.seo_title, "tr")) p.push("SEO başlığı yok");
    else if (x.seo_title && len(x.seo_title, "tr") > 65) p.push("SEO başlığı 65 karakterden uzun");
    if (x.seo_description !== undefined && !len(x.seo_description, "tr") && !len(x.summary, "tr")) p.push("Arama açıklaması yok");
    else if (x.seo_description && len(x.seo_description, "tr") > 160) p.push("Arama açıklaması 160 karakterden uzun");
    if (x.body !== undefined) {
      const w = (t(x.body, "tr") || "").split(/\s+/).filter(Boolean).length;
      if (w < 150) p.push(`İçerik kısa (${w} kelime; Google ve yapay zekâ için 300+ önerilir)`);
      for (const l of ["en", "fr"]) if (len(x.body, "tr") && !len(x.body, l)) p.push(`${l.toUpperCase()} içerik çevrilmemiş`);
    }
    if (x.image_path !== undefined && !x.image_path) p.push("Görsel yok (paylaşımlarda ve Google görsellerde görünmez)");
    if (p.length) issues.push({ where, href, edit, problems: p, score: p.length });
  };
  for (const x of (pr ?? []) as Array<Record<string, unknown>>) check(`Ürün · ${t(x.name as I18nText, "tr")}`, `/tr/urunler/${x.slug}`, `/admin/urunler/${x.id}`, x, faqProducts.has(x.slug as string) ? [] : ["Ürüne özel soru-cevap yok (SSS'den bağlayın)"]);
  for (const x of (pg ?? []) as Array<Record<string, unknown>>) check(`Sayfa · ${t(x.title as I18nText, "tr")}`, `/tr/${x.slug}`, `/admin/sayfalar/${x.id}`, x);
  for (const x of (po ?? []) as Array<Record<string, unknown>>) check(`Blog · ${t(x.title as I18nText, "tr")}`, `/tr/blog/${x.slug}`, `/admin/blog/${x.id}`, x);
  for (const x of (ar ?? []) as Array<Record<string, unknown>>) check(`Bölge · ${t(x.name as I18nText, "tr")}`, `/tr/bolge/${x.slug}`, `/admin/bolgeler/${x.id}`, { name: x.name as I18nText }, [
    ...(t(x.body as I18nText, "tr") ? [] : ["Özel içerik yok (şablon metin kullanılıyor; yerel bilgi eklemek sıralamayı artırır)"]), ...(faqAreas.has(x.slug as string) ? [] : ["Bölgeye özel soru-cevap yok"]),
  ]);
  issues.sort((a, b) => b.score - a.score);
  const nfMap = new Map<string, { n: number; last: string }>();
  for (const h of (nf ?? []) as Array<{ path: string; at: string }>) { const c = nfMap.get(h.path); nfMap.set(h.path, { n: (c?.n ?? 0) + 1, last: c && c.last > h.at ? c.last : h.at }); }
  const total = ((pr ?? []).length + (pg ?? []).length + (po ?? []).length + (ar ?? []).length) || 1;
  const health = Math.round(100 * (1 - issues.length / total));
  return (
    <>
      <PageHead title="SEO ve yapay zekâ hazırlığı" lead="Her sayfa için eksik başlık, açıklama, çeviri, görsel ve soru-cevap; bulunamayan (404) sayfalar." />
      <section className="mb-6 grid gap-4 md:grid-cols-3">
        <div className="rounded-2xl bg-navy p-5 text-white"><span className="text-xs uppercase tracking-wider text-white/60">Hazır sayfa oranı</span><b className="mt-1 block text-4xl num">%{Math.max(0, health)}</b><span className="text-xs text-white/60">{total} sayfadan {issues.length} tanesinde eksik var</span></div>
        <div className="rounded-2xl border border-gypsum bg-white p-5"><span className="text-xs text-slate">Bulunamayan sayfa (30 gün)</span><b className="mt-1 block text-4xl num text-navy">{nfMap.size}</b></div>
        <div className="rounded-2xl border border-gypsum bg-white p-5 text-sm text-slate">Yapay zekâ dosyaları: <a href="/llms.txt" target="_blank" className="font-semibold text-navy">llms.txt</a> · <a href="/llms-full.txt" target="_blank" className="font-semibold text-navy">llms-full.txt</a> · <a href="/robots.txt" target="_blank" className="font-semibold text-navy">robots.txt</a> · <a href="/sitemap.xml" target="_blank" className="font-semibold text-navy">sitemap.xml</a></div>
      </section>
      {nfMap.size > 0 && (
        <section className="mb-6 rounded-2xl border border-rose-200 bg-rose-50/50 p-5">
          <h2 className="display text-lg font-semibold text-navy">⚠ Bulunamayan sayfalar (404)</h2>
          <p className="text-xs text-slate">Bu adreslere gelen ziyaretçi boş sayfa görüyor. Eski adresse yönlendirme (301) ekletin ya da bağlantıyı düzeltin.</p>
          <ul className="mt-3 grid gap-1 text-sm">{[...nfMap.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 30).map(([p, v]) => <li key={p} className="flex gap-3"><code className="flex-1 truncate">{p}</code><b className="num">{v.n}×</b></li>)}</ul>
        </section>
      )}
      <ul className="grid gap-3">
        {issues.map((i) => (
          <li key={i.edit} className="rounded-2xl border border-gypsum bg-white p-4">
            <div className="flex flex-wrap items-center gap-3"><b className="flex-1 text-navy">{i.where}</b><a href={i.href} target="_blank" rel="noreferrer" className="text-xs text-slate">Gör ↗</a><Link href={i.edit} className="rounded-full bg-navy px-3 py-1 text-xs font-semibold text-white">Düzelt →</Link></div>
            <ul className="mt-2 flex flex-wrap gap-1.5">{i.problems.map((p) => <li key={p} className="rounded-full bg-amber-50 px-2.5 py-1 text-xs text-amber-800">{p}</li>)}</ul>
          </li>
        ))}
        {!issues.length && <li className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6 text-center text-emerald-800">🎉 Tüm sayfalar hazır.</li>}
      </ul>
    </>
  );
}
