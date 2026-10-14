import Link from "next/link";
import { notFound } from "next/navigation";
import { Flash, I18nField, PageHead } from "@/components/admin/ui";
import type { Material } from "@/lib/cms";
import { saveMaterial } from "@/lib/growth-actions";
import { t } from "@/lib/i18n";
import { MAT_UI } from "@/lib/pages-ui";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Malzeme" };
export default async function MaterialEdit({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ hata?: string }> }) {
  const { id } = await params;
  const { hata } = await searchParams;
  const supabase = await createClient();
  let m: Material | undefined;
  if (id !== "yeni") {
    if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
    const { data } = await supabase.from("cms_materials").select("*").eq("id", id).maybeSingle();
    if (!data) notFound();
    m = data as Material;
  }
  const { data: pr } = await supabase.from("cms_products").select("slug, name").is("deleted_at", null).order("sort");
  return (
    <>
      <PageHead title={m ? t(m.name, "tr") : "Yeni malzeme"} />
      <Flash hata={hata} />
      <form action={saveMaterial} className="grid gap-5">
        {m && <input type="hidden" name="id" value={m.id} />}
        <div className="grid gap-4 rounded-xl border border-gypsum bg-white p-4 sm:grid-cols-4">
          <label className="grid gap-1 text-sm font-semibold text-navy">Grup<select name="category" defaultValue={m?.category ?? "ceramic"} className="field font-normal">{Object.entries(MAT_UI.tr.cats).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
          <label className="grid gap-1 text-sm font-semibold text-navy">Adres (slug)<input name="slug" defaultValue={m?.slug ?? ""} placeholder="otomatik" className="field font-normal" /></label>
          <label className="grid gap-1 text-sm font-semibold text-navy">Sıra<input name="sort" type="number" defaultValue={m?.sort ?? 0} className="field font-normal" /></label>
          <label className="grid gap-1 text-sm font-semibold text-navy">Görsel<input name="image_path" defaultValue={m?.image_path ?? ""} placeholder="medya yolu ya da https://" className="field font-normal" /></label>
        </div>
        <I18nField name="name" label="Malzeme adı" value={m?.name} required />
        <I18nField name="summary" label="Kısa tanım" value={m?.summary} multiline rows={2} hint="İlk cümlede net cevap: ne, nerede kullanılır." />
        <I18nField name="body" label="Ayrıntılı içerik" value={m?.body} multiline rows={8} hint="Avantajlar, sınırlamalar, hazırlık önerileri, hangi vakada tercih edilir." />
        <I18nField name="indications" label="Kullanım alanları (her satıra bir)" value={m?.indications} multiline rows={4} />
        <label className="grid gap-1 rounded-xl border border-gypsum bg-white p-4 text-sm font-semibold text-navy">Teknik özellikler <span className="text-xs font-normal text-slate">Her satıra “özellik | değer”, ör. “Bükülme dayanımı | 1100 MPa”. Üreticinin teknik föyündeki değerleri girin.</span>
          <textarea name="props" rows={5} defaultValue={(m?.props ?? []).map((p) => `${t(p.k, "tr")} | ${p.v}`).join("\n")} className="field font-normal" />
        </label>
        <label className="grid gap-1 text-sm font-semibold text-navy">Markalar<input name="brands" defaultValue={m?.brands ?? ""} placeholder="ör. Ivoclar IPS e.max, Zirkonzahn Prettau" className="field font-normal" /></label>
        <fieldset className="rounded-xl border border-gypsum bg-white p-4"><legend className="px-1 text-sm font-semibold text-navy">Bu malzemeyle yapılan ürünler</legend>
          <div className="flex flex-wrap gap-3">{((pr ?? []) as Array<{ slug: string; name: Record<string, string> }>).map((p) => <label key={p.slug} className="flex items-center gap-1.5 text-sm"><input type="checkbox" name="product_slugs" value={p.slug} defaultChecked={m?.product_slugs.includes(p.slug)} />{t(p.name, "tr")}</label>)}</div>
        </fieldset>
        <label className="flex items-center gap-3 text-sm font-semibold text-navy"><input type="checkbox" name="is_active" defaultChecked={m?.is_active ?? true} className="h-5 w-5 accent-navy" /> Sitede yayında</label>
        <div className="flex gap-3"><button className="rounded-full bg-navy px-6 py-3 font-semibold text-white">Kaydet</button><Link href="/admin/malzemeler" className="px-3 py-3 font-semibold text-slate">Vazgeç</Link></div>
      </form>
    </>
  );
}
