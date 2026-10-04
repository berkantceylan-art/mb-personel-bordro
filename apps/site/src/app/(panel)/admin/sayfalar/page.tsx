import Link from "next/link";
import { PAGE_GROUP_LABELS } from "@/components/admin/PageForm";
import { RowActions } from "@/components/admin/RowActions";
import { FilterTabs, Flash, PageHead, formatTr } from "@/components/admin/ui";
import { movePage } from "@/lib/admin-actions";
import { PAGE_GROUPS, liveState, type SitePage } from "@/lib/cms";
import { t } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Sayfalar" };

const state = (p: SitePage) => liveState({ ...p, starts_at: null, ends_at: null });

export default async function PagesPage({ searchParams }: { searchParams: Promise<{ durum?: string; ok?: string; hata?: string }> }) {
  const { durum = "", ok, hata } = await searchParams;
  const supabase = await createClient();
  const { data } = await supabase.from("cms_pages").select("*").order("sort");
  const all = (data ?? []) as SitePage[];
  const counts = {
    "": all.filter((r) => !r.deleted_at).length,
    yayinda: all.filter((r) => state(r) === "live").length,
    taslak: all.filter((r) => state(r) === "draft").length,
    cop: all.filter((r) => r.deleted_at).length,
  };
  const rows = all.filter((r) => (durum === "cop" ? r.deleted_at : !r.deleted_at && (durum === "yayinda" ? state(r) === "live" : durum === "taslak" ? state(r) === "draft" : true)));
  const groups = PAGE_GROUPS.map((g) => ({ g, items: rows.filter((r) => r.group === g) })).filter((x) => x.items.length > 0);

  return (
    <>
      <PageHead title="Sayfalar" lead="Hakkımızda, teknoloji ve kalite gibi kurumsal sayfalar." action={{ href: "/admin/sayfalar/yeni", label: "Yeni sayfa" }} />
      <Flash ok={ok} hata={hata} />
      <FilterTabs base="/admin/sayfalar" current={durum} counts={counts} />
      {groups.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gypsum bg-white p-10 text-center text-slate">{durum === "cop" ? "Çöp kutusu boş." : "Henüz sayfa yok."}</div>
      ) : (
        <div className="grid gap-8">
          {groups.map(({ g, items }) => (
            <section key={g}>
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate">
                {PAGE_GROUP_LABELS[g]} <span className="num font-normal">({items.length})</span>
              </h2>
              <ul className="divide-y divide-gypsum rounded-2xl border border-gypsum bg-white">
                {items.map((r, i) => {
                  const live = state(r) === "live";
                  return (
                    <li key={r.id} className="grid gap-4 p-4 sm:grid-cols-[auto_1fr_auto] sm:items-center">
                      {durum !== "cop" ? (
                        <div className="flex gap-1 sm:flex-col">
                          {(["up", "down"] as const).map((dir) => (
                            <form key={dir} action={movePage}>
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
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <Link href={`/admin/sayfalar/${r.id}`} className="font-semibold text-navy hover:underline">
                            {t(r.title, "tr") || "(başlıksız)"}
                          </Link>
                          <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${r.deleted_at ? "bg-bad-bg text-bad" : live ? "bg-ok-bg text-ok" : "bg-gypsum text-slate"}`}>
                            {r.deleted_at ? "Çöpte" : live ? "Yayında" : "Taslak"}
                          </span>
                        </div>
                        <p className="mt-1 truncate text-sm text-slate">{t(r.summary, "tr")}</p>
                        <p className="mt-1 text-xs text-slate">
                          /{r.slug} · Diller: {(["tr", "en", "fr"] as const).filter((l) => r.body?.[l]).join(", ").toUpperCase() || "—"} · Güncellendi {formatTr(r.updated_at)}
                        </p>
                      </div>
                      <RowActions table="cms_pages" id={r.id} active={r.is_active} trashed={!!r.deleted_at} />
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
