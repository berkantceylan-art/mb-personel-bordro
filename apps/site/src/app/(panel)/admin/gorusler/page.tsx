import Link from "next/link";
import { RowActions } from "@/components/admin/RowActions";
import { Flash, PageHead } from "@/components/admin/ui";
import type { Testimonial } from "@/lib/cms";
import { t } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Hekim görüşleri" };

export default async function TestimonialsAdmin({ searchParams }: { searchParams: Promise<{ ok?: string; hata?: string; durum?: string }> }) {
  const { ok, hata, durum } = await searchParams;
  const supabase = await createClient();
  const { data, error } = await supabase.from("cms_testimonials").select("*").order("sort");
  const all = (data ?? []) as Testimonial[];
  const rows = all.filter((r) => (durum === "cop" ? r.deleted_at : !r.deleted_at));
  return (
    <>
      <PageHead title="Hekim görüşleri" lead="Anasayfada görünen, izinli ve gerçek hekim görüşleri." action={{ href: "/admin/gorusler/yeni", label: "Yeni görüş" }} />
      <Flash ok={ok} hata={hata} />
      {error && <p className="mb-4 rounded-xl bg-bad-bg p-4 text-sm text-bad">Tablo yok: Supabase&apos;de 20261129000000_site_growth.sql çalıştırın.</p>}
      <div className="mb-3 flex gap-2 text-sm">
        <Link href="/admin/gorusler" className={`rounded-full px-3 py-1.5 font-semibold ${durum !== "cop" ? "bg-navy text-white" : "bg-white text-navy"}`}>Liste</Link>
        <Link href="/admin/gorusler?durum=cop" className={`rounded-full px-3 py-1.5 font-semibold ${durum === "cop" ? "bg-navy text-white" : "bg-white text-navy"}`}>Çöp kutusu</Link>
      </div>
      <ul className="divide-y divide-gypsum rounded-2xl border border-gypsum bg-white">
        {rows.map((r) => (
          <li key={r.id} className="grid gap-3 p-4 sm:grid-cols-[1fr_auto] sm:items-center">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <Link href={`/admin/gorusler/${r.id}`} className="font-semibold text-navy hover:underline">{r.name}</Link>
                <span className="text-xs text-slate">{r.role}</span>
                {!r.consent && <span className="rounded-full bg-warn-bg px-2 py-0.5 text-xs font-semibold text-warn">İzin yok</span>}
                <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${r.is_active ? "bg-ok-bg text-ok" : "bg-gypsum text-slate"}`}>{r.is_active ? "Yayında" : "Taslak"}</span>
              </div>
              <p className="mt-1 line-clamp-2 text-sm text-slate">“{t(r.quote, "tr")}”</p>
            </div>
            <RowActions table="cms_testimonials" id={r.id} active={r.is_active} trashed={!!r.deleted_at} />
          </li>
        ))}
        {rows.length === 0 && <li className="p-10 text-center text-slate">Henüz görüş yok.</li>}
      </ul>
    </>
  );
}
