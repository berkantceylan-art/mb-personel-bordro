import Link from "next/link";
import { PageHead, StateBadge, formatTr } from "@/components/admin/ui";
import { liveState, type Announcement, type Slide } from "@/lib/cms";
import { t } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Pano" };

export default async function Dashboard() {
  const supabase = await createClient();
  const [{ data: slides }, { data: anns }, { count: productCount }, { data: unread }] = await Promise.all([
    supabase.from("cms_slides").select("*").is("deleted_at", null).order("sort"),
    supabase.from("cms_announcements").select("*").is("deleted_at", null).order("updated_at", { ascending: false }),
    supabase.from("cms_products").select("id", { count: "exact", head: true }).is("deleted_at", null).eq("is_active", true),
    supabase.rpc("cms_unread_messages"),
  ]);
  const s = (slides ?? []) as Slide[];
  const a = (anns ?? []) as Announcement[];
  const soon = Date.now() + 7 * 24 * 3600 * 1000;
  const ending = [...s.map((r) => ({ ...r, _type: "Slayt", _href: `/admin/slaytlar/${r.id}` })), ...a.map((r) => ({ ...r, _type: "Duyuru", _href: `/admin/duyurular/${r.id}` }))].filter(
    (r) => liveState(r) === "live" && r.ends_at && Date.parse(r.ends_at) < soon,
  );

  const tiles = [
    { label: "Okunmamış mesaj", value: typeof unread === "number" ? unread : 0, href: "/admin/gelen-kutusu?kutu=yeni" },
    { label: "Yayında ürün", value: productCount ?? 0, href: "/admin/urunler?durum=yayinda" },
    { label: "Yayında slayt", value: s.filter((r) => liveState(r) === "live").length, href: "/admin/slaytlar?durum=yayinda" },
    { label: "Yayında duyuru", value: a.filter((r) => liveState(r) === "live").length, href: "/admin/duyurular?durum=yayinda" },
    { label: "Taslak", value: [...s, ...a].filter((r) => liveState(r) === "draft").length, href: "/admin/slaytlar?durum=taslak" },
    { label: "Zamanlanmış", value: [...s, ...a].filter((r) => liveState(r) === "scheduled").length, href: "/admin/duyurular" },
  ];

  return (
    <>
      <PageHead title="Pano" lead="Sitede şu an yayında olanlar ve yakında süresi dolacaklar." />
      <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {tiles.map((tile) => (
          <li key={tile.label}>
            <Link href={tile.href} className="block rounded-2xl border border-gypsum bg-white p-5 hover:border-navy">
              <p className="display num text-4xl font-semibold text-navy">{tile.value}</p>
              <p className="mt-1 text-sm text-slate">{tile.label}</p>
            </Link>
          </li>
        ))}
      </ul>

      <section className="mt-10">
        <h2 className="display text-xl font-semibold text-navy">7 gün içinde yayından kalkacaklar</h2>
        {ending.length === 0 ? (
          <p className="mt-3 text-slate">Önümüzdeki hafta süresi dolan içerik yok.</p>
        ) : (
          <ul className="mt-3 divide-y divide-gypsum rounded-2xl border border-gypsum bg-white">
            {ending.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                <Link href={r._href} className="font-semibold text-navy hover:underline">
                  {r._type}: {t(r.title, "tr")}
                </Link>
                <span className="flex items-center gap-3 text-sm text-slate">
                  {formatTr(r.ends_at)} <StateBadge row={r} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-10 grid gap-4 md:grid-cols-2">
        <Link href="/admin/slaytlar/yeni" className="rounded-2xl bg-navy p-6 text-white hover:bg-blue">
          <p className="display text-xl font-semibold">Yeni slayt ekle</p>
          <p className="mt-1 text-sm text-white/70">Anasayfadaki &quot;Laboratuvardan&quot; şeridinde görünür.</p>
        </Link>
        <Link href="/admin/duyurular/yeni" className="rounded-2xl border-2 border-navy bg-white p-6 text-navy hover:bg-porcelain">
          <p className="display text-xl font-semibold">Yeni duyuru ekle</p>
          <p className="mt-1 text-sm text-slate">Üst bant, açılır pencere ya da haber olarak.</p>
        </Link>
      </section>
    </>
  );
}
