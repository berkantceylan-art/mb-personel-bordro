import { SimpleRows } from "@/components/admin/SimpleRows";
import { Flash, PageHead } from "@/components/admin/ui";
import type { Material } from "@/lib/cms";
import { t } from "@/lib/i18n";
import { MAT_UI } from "@/lib/pages-ui";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Malzeme kütüphanesi" };
export default async function MaterialsAdmin({ searchParams }: { searchParams: Promise<{ ok?: string; hata?: string }> }) {
  const { ok, hata } = await searchParams;
  const supabase = await createClient();
  const { data, error } = await supabase.from("cms_materials").select("*").is("deleted_at", null).order("sort");
  const rows = ((data ?? []) as Material[]).map((m) => ({ id: m.id, title: t(m.name, "tr"), sub: `${MAT_UI.tr.cats[m.category] ?? m.category} · ${m.props.length} özellik${t(m.body, "tr") ? " · içerik var" : " · içerik yok"}`, href: `/admin/malzemeler/${m.id}`, view: `/tr/malzemeler/${m.slug}`, draft: !m.is_active }));
  return (<><PageHead title="Malzeme kütüphanesi" lead="Sitede /malzemeler: zirkon, E.max, PMMA… Yapay zekânın kaynak olarak en çok alıntıladığı içerik türü: teknik değerleri ve kullanım alanlarını ekleyin." action={{ href: "/admin/malzemeler/yeni", label: "Yeni malzeme" }} /><Flash ok={ok} hata={hata ?? (error ? "Supabase'de 20270204000000_site_pages_plus.sql çalıştırılmalı." : undefined)} /><SimpleRows table="cms_materials" rows={rows} empty="Henüz malzeme yok." /></>);
}
