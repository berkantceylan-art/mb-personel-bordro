import Link from "next/link";
import { RowActions } from "@/components/admin/RowActions";
import { FilterTabs, Flash, PageHead, StateBadge, formatTr } from "@/components/admin/ui";
import { liveState, type Announcement } from "@/lib/cms";
import { t } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Duyurular" };

const KIND: Record<Announcement["kind"], string> = { banner: "Üst bant", news: "Haber", popup: "Açılır pencere" };
const AUD: Record<Announcement["audience"], string> = { public: "Herkes", portal: "Portal" };

export default async function AnnouncementsPage({ searchParams }: { searchParams: Promise<{ durum?: string; ok?: string; hata?: string }> }) {
  const { durum = "", ok, hata } = await searchParams;
  const supabase = await createClient();
  const { data } = await supabase.from("cms_announcements").select("*").order("priority", { ascending: false }).order("updated_at", { ascending: false });
  const all = (data ?? []) as Announcement[];
  const counts = {
    "": all.filter((r) => !r.deleted_at).length,
    yayinda: all.filter((r) => liveState(r) === "live").length,
    taslak: all.filter((r) => liveState(r) === "draft").length,
    cop: all.filter((r) => r.deleted_at).length,
  };
  const rows = all.filter((r) =>
    durum === "cop" ? r.deleted_at : !r.deleted_at && (durum === "yayinda" ? liveState(r) === "live" : durum === "taslak" ? liveState(r) === "draft" : true),
  );

  return (
    <>
      <PageHead title="Duyurular" lead="Üst bant, haber ya da açılır pencere. Tarih verirseniz o aralıkta yayında kalır." action={{ href: "/admin/duyurular/yeni", label: "Yeni duyuru" }} />
      <Flash ok={ok} hata={hata} />
      <FilterTabs base="/admin/duyurular" current={durum} counts={counts} />
      {rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gypsum bg-white p-10 text-center">
          <p className="text-slate">{durum === "cop" ? "Çöp kutusu boş." : "Henüz duyuru yok."}</p>
          {durum !== "cop" && (
            <Link href="/admin/duyurular/yeni" className="mt-3 inline-block font-semibold text-navy underline-offset-4 hover:underline">
              İlk duyuruyu ekleyin
            </Link>
          )}
        </div>
      ) : (
        <ul className="divide-y divide-gypsum rounded-2xl border border-gypsum bg-white">
          {rows.map((r) => (
            <li key={r.id} className="grid gap-3 p-4 sm:grid-cols-[1fr_auto] sm:items-center">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Link href={`/admin/duyurular/${r.id}`} className="font-semibold text-navy hover:underline">
                    {t(r.title, "tr") || "(başlıksız)"}
                  </Link>
                  <StateBadge row={r} />
                </div>
                <p className="mt-1 text-xs text-slate">
                  {KIND[r.kind]} · {AUD[r.audience]} · Öncelik {r.priority} ·{" "}
                  {r.starts_at || r.ends_at ? `${formatTr(r.starts_at)} – ${formatTr(r.ends_at)}` : "Tarih sınırı yok"}
                </p>
              </div>
              <RowActions table="cms_announcements" id={r.id} active={r.is_active} trashed={!!r.deleted_at} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
