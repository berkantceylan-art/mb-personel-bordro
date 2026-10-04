import Link from "next/link";
import { RowActions } from "@/components/admin/RowActions";
import { FilterTabs, Flash, PageHead, formatTr } from "@/components/admin/ui";
import { moveProduct } from "@/lib/admin-actions";
import { PRODUCT_CATEGORIES, mediaUrl, productState, type Product } from "@/lib/cms";
import { PRODUCT_UI, t } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Ürünler" };

const BADGE = {
  live: { label: "Yayında", cls: "bg-ok-bg text-ok" },
  draft: { label: "Taslak", cls: "bg-gypsum text-slate" },
  trash: { label: "Çöpte", cls: "bg-bad-bg text-bad" },
} as const;

export default async function ProductsPage({ searchParams }: { searchParams: Promise<{ durum?: string; ok?: string; hata?: string }> }) {
  const { durum = "", ok, hata } = await searchParams;
  const supabase = await createClient();
  const { data } = await supabase.from("cms_products").select("*").order("sort");
  const all = (data ?? []) as Product[];
  const counts = {
    "": all.filter((r) => !r.deleted_at).length,
    yayinda: all.filter((r) => productState(r) === "live").length,
    taslak: all.filter((r) => productState(r) === "draft").length,
    cop: all.filter((r) => r.deleted_at).length,
  };
  const rows = all.filter((r) =>
    durum === "cop" ? r.deleted_at : !r.deleted_at && (durum === "yayinda" ? productState(r) === "live" : durum === "taslak" ? productState(r) === "draft" : true),
  );
  const groups = PRODUCT_CATEGORIES.map((c) => ({ c, items: rows.filter((r) => r.category === c) })).filter((g) => g.items.length > 0);

  return (
    <>
      <PageHead title="Ürünler" lead="Sitedeki ürün sayfaları. Sıra, gruplar içinde oklarla değişir." action={{ href: "/admin/urunler/yeni", label: "Yeni ürün" }} />
      <Flash ok={ok} hata={hata} />
      <FilterTabs base="/admin/urunler" current={durum} counts={counts} />
      {groups.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gypsum bg-white p-10 text-center">
          <p className="text-slate">{durum === "cop" ? "Çöp kutusu boş." : "Henüz ürün yok."}</p>
          {durum !== "cop" && (
            <Link href="/admin/urunler/yeni" className="mt-3 inline-block font-semibold text-navy underline-offset-4 hover:underline">
              İlk ürünü ekleyin
            </Link>
          )}
        </div>
      ) : (
        <div className="grid gap-8">
          {groups.map(({ c, items }) => (
            <section key={c} aria-labelledby={`g-${c}`}>
              <h2 id={`g-${c}`} className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate">
                {PRODUCT_UI.tr.categories[c]} <span className="num font-normal">({items.length})</span>
              </h2>
              <ul className="divide-y divide-gypsum rounded-2xl border border-gypsum bg-white">
                {items.map((r, i) => {
                  const img = mediaUrl(r.image_path);
                  const b = BADGE[productState(r) as keyof typeof BADGE] ?? BADGE.draft;
                  return (
                    <li key={r.id} className="grid gap-4 p-4 sm:grid-cols-[auto_5rem_1fr_auto] sm:items-center">
                      {durum !== "cop" ? (
                        <div className="flex gap-1 sm:flex-col">
                          {(["up", "down"] as const).map((dir) => (
                            <form key={dir} action={moveProduct}>
                              <input type="hidden" name="id" value={r.id} />
                              <input type="hidden" name="dir" value={dir} />
                              <button
                                type="submit"
                                disabled={(dir === "up" && i === 0) || (dir === "down" && i === items.length - 1)}
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
                      <div className="aspect-square w-20 overflow-hidden rounded-lg bg-gypsum">
                        {img && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={img} alt="" className="h-full w-full object-cover" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <Link href={`/admin/urunler/${r.id}`} className="font-semibold text-navy hover:underline">
                            {t(r.name, "tr") || "(adsız)"}
                          </Link>
                          <span className={`inline-block whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ${b.cls}`}>{b.label}</span>
                        </div>
                        <p className="mt-1 truncate text-sm text-slate">{t(r.summary, "tr")}</p>
                        <p className="mt-1 text-xs text-slate">
                          /urunler/{r.slug} · Diller: {(["tr", "en", "fr"] as const).filter((l) => r.body?.[l]).join(", ").toUpperCase() || "—"} · {r.gallery.length} galeri görseli · Güncellendi{" "}
                          {formatTr(r.updated_at)}
                        </p>
                      </div>
                      <RowActions table="cms_products" id={r.id} active={r.is_active} trashed={!!r.deleted_at} />
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </>
  );
}
