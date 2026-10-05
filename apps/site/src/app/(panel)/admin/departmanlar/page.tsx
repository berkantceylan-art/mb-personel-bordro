import { SimpleList } from "@/components/admin/SimpleList";
import { FilterTabs, Flash, PageHead } from "@/components/admin/ui";
import { mediaUrl, type Department } from "@/lib/cms";
import { t } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Departmanlar" };

export default async function DepartmentsPage({ searchParams }: { searchParams: Promise<{ durum?: string; ok?: string; hata?: string }> }) {
  const { durum = "", ok, hata } = await searchParams;
  const supabase = await createClient();
  const { data, error } = await supabase.from("cms_departments").select("*").order("sort");
  const all = (data ?? []) as Department[];
  const counts = {
    "": all.filter((r) => !r.deleted_at).length,
    yayinda: all.filter((r) => !r.deleted_at && r.is_active).length,
    taslak: all.filter((r) => !r.deleted_at && !r.is_active).length,
    cop: all.filter((r) => r.deleted_at).length,
  };
  const rows = all.filter((r) => (durum === "cop" ? r.deleted_at : !r.deleted_at && (durum === "yayinda" ? r.is_active : durum === "taslak" ? !r.is_active : true)));
  return (
    <>
      <PageHead title="Departmanlar" lead="Sitede “Ekibimiz” sayfasında fotoğraflarıyla görünür." action={{ href: "/admin/departmanlar/yeni", label: "Yeni departman" }} />
      <Flash ok={ok} hata={hata ?? (error ? "Departman tablosu henüz kurulmamış (SQL dosyası çalıştırılmalı)." : undefined)} />
      <FilterTabs base="/admin/departmanlar" current={durum} counts={counts} />
      <SimpleList
        table="cms_departments"
        editBase="/admin/departmanlar"
        trash={durum === "cop"}
        empty={durum === "cop" ? "Çöp kutusu boş." : "Henüz departman yok."}
        groups={[
          {
            rows: rows.map((r) => ({
              id: r.id,
              title: t(r.name, "tr") || "(adsız)",
              subtitle: `${t(r.description, "tr")}${r.gallery.length ? ` · ${r.gallery.length} fotoğraf` : ""}`,
              thumb: mediaUrl(r.image_path),
              active: r.is_active,
              trashed: !!r.deleted_at,
            })),
          },
        ]}
      />
    </>
  );
}
