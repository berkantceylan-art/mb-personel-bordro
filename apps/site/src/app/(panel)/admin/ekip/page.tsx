import { SimpleList } from "@/components/admin/SimpleList";
import { FilterTabs, Flash, PageHead } from "@/components/admin/ui";
import { mediaUrl, type Department, type TeamMember } from "@/lib/cms";
import { t } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Çalışanlar" };

export default async function TeamPage({ searchParams }: { searchParams: Promise<{ durum?: string; ok?: string; hata?: string }> }) {
  const { durum = "", ok, hata } = await searchParams;
  const supabase = await createClient();
  const [{ data, error }, { data: deps }] = await Promise.all([
    supabase.from("cms_team").select("*").order("sort"),
    supabase.from("cms_departments").select("*").is("deleted_at", null).order("sort"),
  ]);
  const all = (data ?? []) as TeamMember[];
  const departments = (deps ?? []) as Department[];
  const counts = {
    "": all.filter((r) => !r.deleted_at).length,
    yayinda: all.filter((r) => !r.deleted_at && r.is_active).length,
    taslak: all.filter((r) => !r.deleted_at && !r.is_active).length,
    cop: all.filter((r) => r.deleted_at).length,
  };
  const rows = all.filter((r) => (durum === "cop" ? r.deleted_at : !r.deleted_at && (durum === "yayinda" ? r.is_active : durum === "taslak" ? !r.is_active : true)));
  const toRow = (r: TeamMember) => ({
    id: r.id,
    title: r.name,
    subtitle: [t(r.role, "tr"), r.employee_id ? "Bordroya bağlı" : ""].filter(Boolean).join(" · "),
    thumb: mediaUrl(r.photo_path),
    round: true,
    active: r.is_active,
    trashed: !!r.deleted_at,
  });
  const known = new Set(departments.map((d) => d.id));
  const groups = [
    ...departments.map((d) => ({ label: t(d.name, "tr"), rows: rows.filter((r) => r.department_id === d.id).map(toRow) })),
    { label: "Departmansız", rows: rows.filter((r) => !r.department_id || !known.has(r.department_id)).map(toRow) },
  ];
  return (
    <>
      <PageHead title="Çalışanlar" lead="Sitede “Ekibimiz” sayfasında departmanlarına göre gruplanarak görünür. Sıralama departman içinde yapılır." action={{ href: "/admin/ekip/yeni", label: "Yeni çalışan" }} />
      <p className="-mt-3 mb-5 text-sm">
        <a href="/admin/ekip/bordro" className="font-semibold text-navy underline">
          Bordro / personel kayıtlarından aktar →
        </a>
      </p>
      <Flash ok={ok} hata={hata ?? (error ? "Çalışan tablosu henüz kurulmamış (SQL dosyası çalıştırılmalı)." : undefined)} />
      <FilterTabs base="/admin/ekip" current={durum} counts={counts} />
      <SimpleList table="cms_team" editBase="/admin/ekip" trash={durum === "cop"} empty={durum === "cop" ? "Çöp kutusu boş." : "Henüz çalışan eklenmemiş."} groups={groups} />
    </>
  );
}
