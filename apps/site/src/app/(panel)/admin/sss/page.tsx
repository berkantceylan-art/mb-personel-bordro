import Link from "next/link";
import { RowActions } from "@/components/admin/RowActions";
import { FilterTabs, Flash, PageHead } from "@/components/admin/ui";
import { moveInGroup } from "@/lib/admin-actions";
import { FAQ_CATEGORIES, FAQ_CATEGORY_LABELS, type Faq } from "@/lib/cms";
import { t } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Sıkça sorulanlar" };

export default async function FaqsPage({ searchParams }: { searchParams: Promise<{ durum?: string; ok?: string; hata?: string }> }) {
  const { durum = "", ok, hata } = await searchParams;
  const supabase = await createClient();
  const { data, error } = await supabase.from("cms_faqs").select("*").order("sort");
  const all = (data ?? []) as Faq[];
  const counts = {
    "": all.filter((r) => !r.deleted_at).length,
    yayinda: all.filter((r) => !r.deleted_at && r.is_active).length,
    taslak: all.filter((r) => !r.deleted_at && !r.is_active).length,
    cop: all.filter((r) => r.deleted_at).length,
  };
  const rows = all.filter((r) => (durum === "cop" ? r.deleted_at : !r.deleted_at && (durum === "yayinda" ? r.is_active : durum === "taslak" ? !r.is_active : true)));
  const groups = FAQ_CATEGORIES.map((g) => ({ g, items: rows.filter((r) => r.category === g) })).filter((x) => x.items.length > 0);

  return (
    <>
      <PageHead title="Sıkça sorulanlar" lead="Sitede /sss sayfasında ve Google'da soru-cevap olarak görünür." action={{ href: "/admin/sss/yeni", label: "Yeni soru" }} />
      <Flash ok={ok} hata={hata ?? (error ? "SSS tablosu henüz kurulmamış (SQL dosyası çalıştırılmalı)." : undefined)} />
      <FilterTabs base="/admin/sss" current={durum} counts={counts} />
      {groups.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gypsum bg-white p-10 text-center text-slate">{durum === "cop" ? "Çöp kutusu boş." : "Henüz soru yok."}</div>
      ) : (
        <div className="grid gap-8">
          {groups.map(({ g, items }) => (
            <section key={g}>
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate">
                {FAQ_CATEGORY_LABELS[g].tr} <span className="num font-normal">({items.length})</span>
              </h2>
              <ul className="divide-y divide-gypsum rounded-2xl border border-gypsum bg-white">
                {items.map((r, i) => (
                  <li key={r.id} className="grid gap-4 p-4 sm:grid-cols-[auto_1fr_auto] sm:items-center">
                    {durum !== "cop" ? (
                      <div className="flex gap-1 sm:flex-col">
                        {(["up", "down"] as const).map((dir) => (
                          <form key={dir} action={moveInGroup}>
                            <input type="hidden" name="table" value="cms_faqs" />
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
                        <Link href={`/admin/sss/${r.id}`} className="font-semibold text-navy hover:underline">
                          {t(r.question, "tr") || "(boş)"}
                        </Link>
                        <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${r.deleted_at ? "bg-bad-bg text-bad" : r.is_active ? "bg-ok-bg text-ok" : "bg-gypsum text-slate"}`}>
                          {r.deleted_at ? "Çöpte" : r.is_active ? "Yayında" : "Taslak"}
                        </span>
                      </div>
                      <p className="mt-1 line-clamp-2 text-sm text-slate">{t(r.answer, "tr")}</p>
                      <p className="mt-1 text-xs text-slate">Diller: {(["tr", "en", "fr"] as const).filter((l) => r.answer?.[l]).join(", ").toUpperCase() || "—"}</p>
                    </div>
                    <RowActions table="cms_faqs" id={r.id} active={r.is_active} trashed={!!r.deleted_at} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </>
  );
}
