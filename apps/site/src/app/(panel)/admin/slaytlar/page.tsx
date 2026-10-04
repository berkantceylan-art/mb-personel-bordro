import Link from "next/link";
import { RowActions } from "@/components/admin/RowActions";
import { FilterTabs, Flash, PageHead, StateBadge, formatTr } from "@/components/admin/ui";
import { moveSlide } from "@/lib/admin-actions";
import { liveState, mediaUrl, type Slide } from "@/lib/cms";
import { t } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Slaytlar" };

export default async function SlidesPage({ searchParams }: { searchParams: Promise<{ durum?: string; ok?: string; hata?: string }> }) {
  const { durum = "", ok, hata } = await searchParams;
  const supabase = await createClient();
  const { data } = await supabase.from("cms_slides").select("*").order("placement").order("sort");
  const all = (data ?? []) as Slide[];
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
      <PageHead title="Slaytlar" lead="Anasayfadaki görsel şerit. Sırayı oklarla değiştirin; tarih verirseniz o aralıkta görünür." action={{ href: "/admin/slaytlar/yeni", label: "Yeni slayt" }} />
      <Flash ok={ok} hata={hata} />
      <FilterTabs base="/admin/slaytlar" current={durum} counts={counts} />
      {rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gypsum bg-white p-10 text-center">
          <p className="text-slate">{durum === "cop" ? "Çöp kutusu boş." : "Henüz slayt yok."}</p>
          {durum !== "cop" && (
            <Link href="/admin/slaytlar/yeni" className="mt-3 inline-block font-semibold text-navy underline-offset-4 hover:underline">
              İlk slaytı ekleyin
            </Link>
          )}
        </div>
      ) : (
        <ul className="divide-y divide-gypsum rounded-2xl border border-gypsum bg-white">
          {rows.map((r, i) => {
            const img = mediaUrl(r.image_path);
            return (
              <li key={r.id} className="grid gap-4 p-4 sm:grid-cols-[auto_7rem_1fr_auto] sm:items-center">
                {durum !== "cop" ? (
                  <div className="flex gap-1 sm:flex-col">
                    {(["up", "down"] as const).map((dir) => (
                      <form key={dir} action={moveSlide}>
                        <input type="hidden" name="id" value={r.id} />
                        <input type="hidden" name="dir" value={dir} />
                        <button
                          type="submit"
                          disabled={(dir === "up" && i === 0) || (dir === "down" && i === rows.length - 1)}
                          aria-label={dir === "up" ? "Yukarı taşı" : "Aşağı taşı"}
                          className="grid h-7 w-7 place-items-center rounded-full border border-gypsum text-slate hover:border-navy hover:text-navy disabled:opacity-30"
                        >
                          {dir === "up" ? "▲" : "▼"}
                        </button>
                      </form>
                    ))}
                  </div>
                ) : (
                  <span />
                )}
                <div className="aspect-[4/3] w-28 overflow-hidden rounded-lg bg-gypsum">
                  {img && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={img} alt="" className="h-full w-full object-cover" />
                  )}
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`/admin/slaytlar/${r.id}`} className="font-semibold text-navy hover:underline">
                      {t(r.title, "tr") || "(başlıksız)"}
                    </Link>
                    <StateBadge row={r} />
                  </div>
                  <p className="mt-1 text-xs text-slate">
                    Yer: {r.placement} · {r.starts_at || r.ends_at ? `${formatTr(r.starts_at)} – ${formatTr(r.ends_at)}` : "Tarih sınırı yok"} · Güncellendi {formatTr(r.updated_at)}
                  </p>
                  <p className="mt-1 text-xs text-slate">
                    Diller: {(["tr", "en", "fr"] as const).filter((l) => r.title?.[l]).join(", ").toUpperCase() || "—"}
                  </p>
                </div>
                <RowActions table="cms_slides" id={r.id} active={r.is_active} trashed={!!r.deleted_at} />
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
