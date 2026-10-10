import Link from "next/link";
import { POST_CATEGORY_LABELS } from "@/components/admin/PostForm";
import { RowActions } from "@/components/admin/RowActions";
import { FilterTabs, Flash, PageHead, formatTr } from "@/components/admin/ui";
import type { Post } from "@/lib/cms";
import { t } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Blog" };

export default async function BlogAdmin({ searchParams }: { searchParams: Promise<{ durum?: string; ok?: string; hata?: string }> }) {
  const { durum = "", ok, hata } = await searchParams;
  const supabase = await createClient();
  const { data, error } = await supabase.from("cms_posts").select("*").order("publish_at", { ascending: false });
  const all = (data ?? []) as Post[];
  const now = new Date().toISOString();
  const st = (p: Post) => (p.deleted_at ? "cop" : !p.is_active ? "taslak" : p.publish_at > now ? "zamanli" : "yayinda");
  const counts = { "": all.filter((p) => !p.deleted_at).length, yayinda: all.filter((p) => st(p) === "yayinda").length, taslak: all.filter((p) => st(p) === "taslak" || st(p) === "zamanli").length, cop: all.filter((p) => p.deleted_at).length };
  const rows = all.filter((p) => (durum === "cop" ? p.deleted_at : !p.deleted_at && (durum === "yayinda" ? st(p) === "yayinda" : durum === "taslak" ? st(p) !== "yayinda" : true)));
  const badge = { yayinda: ["Yayında", "bg-ok-bg text-ok"], taslak: ["Taslak", "bg-gypsum text-slate"], zamanli: ["Zamanlandı", "bg-warn-bg text-warn"], cop: ["Çöpte", "bg-bad-bg text-bad"] } as const;
  return (
    <>
      <PageHead title="Blog" lead="Hekim rehberleri, vaka hikâyeleri ve haberler. Google'da öne çıkmanın en etkili yolu düzenli yazı." action={{ href: "/admin/blog/yeni", label: "Yeni yazı" }} />
      <Flash ok={ok} hata={hata} />
      {error && <p className="mb-4 rounded-xl bg-bad-bg p-4 text-sm text-bad">Blog tablosu yok: Supabase&apos;de 20261129000000_site_growth.sql çalıştırın.</p>}
      <FilterTabs base="/admin/blog" current={durum} counts={counts} />
      <ul className="divide-y divide-gypsum rounded-2xl border border-gypsum bg-white">
        {rows.map((p) => {
          const [label, cls] = badge[st(p)];
          return (
            <li key={p.id} className="grid gap-3 p-4 sm:grid-cols-[1fr_auto] sm:items-center">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Link href={`/admin/blog/${p.id}`} className="font-semibold text-navy hover:underline">{t(p.title, "tr") || "(başlıksız)"}</Link>
                  <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${cls}`}>{label}</span>
                  <span className="text-xs text-slate">{POST_CATEGORY_LABELS[p.category]}</span>
                </div>
                <p className="mt-1 truncate text-sm text-slate">{t(p.summary, "tr")}</p>
                <p className="mt-1 text-xs text-slate">/blog/{p.slug} · Diller: {(["tr", "en", "fr"] as const).filter((l) => p.body?.[l]).join(", ").toUpperCase() || "—"} · Yayın {formatTr(p.publish_at)}</p>
              </div>
              <RowActions table="cms_posts" id={p.id} active={p.is_active} trashed={!!p.deleted_at} />
            </li>
          );
        })}
        {rows.length === 0 && <li className="p-10 text-center text-slate">{durum === "cop" ? "Çöp kutusu boş." : "Henüz yazı yok."}</li>}
      </ul>
    </>
  );
}
