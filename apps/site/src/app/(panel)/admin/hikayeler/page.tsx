import Link from "next/link";
import { RowActions } from "@/components/admin/RowActions";
import { FilterTabs, Flash, PageHead, StateBadge, formatTr } from "@/components/admin/ui";
import { moveStory } from "@/lib/admin-actions";
import { liveState, mediaUrl, type Story } from "@/lib/cms";
import { t } from "@/lib/i18n";
import { mediaKind } from "@/lib/media";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Hikâyeler" };

export default async function StoriesPage({ searchParams }: { searchParams: Promise<{ durum?: string; ok?: string; hata?: string }> }) {
  const { durum = "", ok, hata } = await searchParams;
  const supabase = await createClient();
  const { data } = await supabase.from("cms_stories").select("*").order("sort");
  const all = (data ?? []) as Story[];
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
      <PageHead title="Hikâyeler" lead="Anasayfanın üstündeki yuvarlak hikâyeler. Soldan sağa bu sırayla görünür." action={{ href: "/admin/hikayeler/yeni", label: "Yeni hikâye" }} />
      <Flash ok={ok} hata={hata} />
      <FilterTabs base="/admin/hikayeler" current={durum} counts={counts} />
      {rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gypsum bg-white p-10 text-center">
          <p className="text-slate">{durum === "cop" ? "Çöp kutusu boş." : "Henüz hikâye yok."}</p>
          {durum !== "cop" && (
            <Link href="/admin/hikayeler/yeni" className="mt-3 inline-block font-semibold text-navy underline-offset-4 hover:underline">
              İlk hikâyeyi ekleyin
            </Link>
          )}
        </div>
      ) : (
        <ul className="divide-y divide-gypsum rounded-2xl border border-gypsum bg-white">
          {rows.map((r, i) => {
            const first = r.frames[0]?.path ?? null;
            const coverPath = r.cover_path ?? (first && mediaKind(null, first) === "image" ? first : null);
            const cover = mediaUrl(coverPath);
            const videoCover = !cover && first ? mediaUrl(first) : null;
            const videos = r.frames.filter((f) => mediaKind(null, f.path) === "video").length;
            return (
              <li key={r.id} className="grid gap-4 p-4 sm:grid-cols-[auto_4rem_1fr_auto] sm:items-center">
                {durum !== "cop" ? (
                  <div className="flex gap-1 sm:flex-col">
                    {(["up", "down"] as const).map((dir) => (
                      <form key={dir} action={moveStory}>
                        <input type="hidden" name="id" value={r.id} />
                        <input type="hidden" name="dir" value={dir} />
                        <button
                          type="submit"
                          disabled={(dir === "up" && i === 0) || (dir === "down" && i === rows.length - 1)}
                          aria-label={dir === "up" ? "Öne al" : "Geriye al"}
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
                <div className="h-16 w-16 overflow-hidden rounded-full bg-gypsum ring-2 ring-smile ring-offset-2">
                  {cover && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={cover} alt="" className="h-full w-full object-cover" />
                  )}
                  {videoCover && <video src={`${videoCover}#t=0.5`} muted preload="metadata" className="h-full w-full object-cover" />}
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`/admin/hikayeler/${r.id}`} className="font-semibold text-navy hover:underline">
                      {t(r.title, "tr") || "(başlıksız)"}
                    </Link>
                    <StateBadge row={r} />
                  </div>
                  <p className="mt-1 text-xs text-slate">
                    {r.frames.length} kare{videos ? ` (${videos} video)` : ""} ·{" "}
                    {r.starts_at || r.ends_at ? `${formatTr(r.starts_at)} – ${formatTr(r.ends_at)}` : "Tarih sınırı yok"} · Güncellendi {formatTr(r.updated_at)}
                  </p>
                </div>
                <RowActions table="cms_stories" id={r.id} active={r.is_active} trashed={!!r.deleted_at} />
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
