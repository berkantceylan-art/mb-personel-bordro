import Link from "next/link";
import { RowActions } from "@/components/admin/RowActions";
import { FilterTabs, Flash, PageHead, formatTr } from "@/components/admin/ui";
import { moveCase } from "@/lib/admin-actions";
import { liveState, mediaUrl, type CaseItem } from "@/lib/cms";
import { t } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Vaka galerisi" };
const state = (c: CaseItem) => liveState({ ...c, starts_at: null, ends_at: null });

export default async function CasesPage({ searchParams }: { searchParams: Promise<{ durum?: string; ok?: string; hata?: string }> }) {
  const { durum = "", ok, hata } = await searchParams;
  const supabase = await createClient();
  const { data } = await supabase.from("cms_cases").select("*").order("sort");
  const all = (data ?? []) as CaseItem[];
  const counts = {
    "": all.filter((r) => !r.deleted_at).length,
    yayinda: all.filter((r) => state(r) === "live").length,
    taslak: all.filter((r) => state(r) === "draft").length,
    cop: all.filter((r) => r.deleted_at).length,
  };
  const rows = all.filter((r) => (durum === "cop" ? r.deleted_at : !r.deleted_at && (durum === "yayinda" ? state(r) === "live" : durum === "taslak" ? state(r) === "draft" : true)));

  return (
    <>
      <PageHead title="Vaka galerisi" lead="Öncesi/sonrası örnek işler. Sitede Vakalar sayfasında, öne çıkanlar anasayfada görünür." action={{ href: "/admin/vakalar/yeni", label: "Yeni vaka" }} />
      <Flash ok={ok} hata={hata} />
      <FilterTabs base="/admin/vakalar" current={durum} counts={counts} />
      {rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gypsum bg-white p-10 text-center">
          <p className="text-slate">{durum === "cop" ? "Çöp kutusu boş." : "Henüz vaka yok."}</p>
          {durum !== "cop" && (
            <Link href="/admin/vakalar/yeni" className="mt-3 inline-block font-semibold text-navy underline-offset-4 hover:underline">
              İlk vakayı ekleyin
            </Link>
          )}
        </div>
      ) : (
        <ul className="divide-y divide-gypsum rounded-2xl border border-gypsum bg-white">
          {rows.map((r, i) => {
            const cover = mediaUrl(r.after_path ?? r.before_path ?? r.gallery[0] ?? null);
            const live = state(r) === "live";
            return (
              <li key={r.id} className="grid gap-4 p-4 sm:grid-cols-[auto_6rem_1fr_auto] sm:items-center">
                {durum !== "cop" ? (
                  <div className="flex gap-1 sm:flex-col">
                    {(["up", "down"] as const).map((dir) => (
                      <form key={dir} action={moveCase}>
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
                <div className="aspect-[4/3] w-24 overflow-hidden rounded-lg bg-gypsum">
                  {cover && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={cover} alt="" className="h-full w-full object-cover" />
                  )}
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`/admin/vakalar/${r.id}`} className="font-semibold text-navy hover:underline">
                      {t(r.title, "tr") || "(başlıksız)"}
                    </Link>
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${r.deleted_at ? "bg-bad-bg text-bad" : live ? "bg-ok-bg text-ok" : "bg-gypsum text-slate"}`}>
                      {r.deleted_at ? "Çöpte" : live ? "Yayında" : "Taslak"}
                    </span>
                    {r.featured && <span className="rounded-full bg-porcelain px-2.5 py-0.5 text-xs font-semibold text-navy">Anasayfada</span>}
                  </div>
                  <p className="mt-1 text-xs text-slate">
                    {r.before_path && r.after_path ? "Öncesi/sonrası" : "Tek görsel"}
                    {r.product_slug ? ` · Ürün: ${r.product_slug}` : ""}
                    {r.teeth ? ` · Diş: ${r.teeth}` : ""} · Güncellendi {formatTr(r.updated_at)}
                  </p>
                </div>
                <RowActions table="cms_cases" id={r.id} active={r.is_active} trashed={!!r.deleted_at} />
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
