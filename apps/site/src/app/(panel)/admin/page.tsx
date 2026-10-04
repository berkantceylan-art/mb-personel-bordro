import Link from "next/link";
import { PageHead, StateBadge, formatTr } from "@/components/admin/ui";
import { TOPIC_LABELS, liveState, type Announcement, type Slide } from "@/lib/cms";
import { t } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Pano" };

export default async function Dashboard() {
  const supabase = await createClient();
  const [{ data: slides }, { data: anns }, { count: productCount }, { data: unread }, { data: msgs }, { data: changes }] = await Promise.all([
    supabase.from("cms_slides").select("*").is("deleted_at", null).order("sort"),
    supabase.from("cms_announcements").select("*").is("deleted_at", null).order("updated_at", { ascending: false }),
    supabase.from("cms_products").select("id", { count: "exact", head: true }).is("deleted_at", null).eq("is_active", true),
    supabase.rpc("cms_unread_messages"),
    supabase.from("cms_messages").select("id, name, company, message, topic, status, created_at").neq("status", "archived").order("created_at", { ascending: false }).limit(5),
    supabase.rpc("cms_audit", { p_limit: 8, p_before: null, p_table: null }),
  ]);
  const recentMessages = (msgs ?? []) as { id: string; name: string; company: string | null; message: string; topic: keyof typeof TOPIC_LABELS; status: string; created_at: string }[];
  const recentChanges = (changes ?? []) as { id: number; table_name: string; action: string; at: string; actor_email: string | null; label: string }[];
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

      <div className="mt-10 grid gap-6 lg:grid-cols-2">
        <section className="rounded-2xl border border-gypsum bg-white p-5">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="display text-xl font-semibold text-navy">Son mesajlar</h2>
            <Link href="/admin/gelen-kutusu" className="text-sm font-semibold text-smile-ink hover:underline">
              Gelen kutusu →
            </Link>
          </div>
          {recentMessages.length === 0 ? (
            <p className="mt-3 text-sm text-slate">Henüz mesaj yok.</p>
          ) : (
            <ul className="mt-3 divide-y divide-gypsum">
              {recentMessages.map((m) => (
                <li key={m.id}>
                  <Link href={`/admin/gelen-kutusu/${m.id}`} className="block py-2.5 hover:text-navy">
                    <span className="flex items-center gap-2 text-sm">
                      {m.status === "new" && <span aria-label="okunmamış" className="h-2 w-2 rounded-full bg-smile" />}
                      <span className={m.status === "new" ? "font-semibold" : ""}>{m.name}</span>
                      <span className="rounded bg-porcelain px-1.5 py-0.5 text-[11px] font-semibold text-navy">{TOPIC_LABELS[m.topic]}</span>
                      <span className="ml-auto whitespace-nowrap text-xs text-slate">{formatTr(m.created_at)}</span>
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-slate">{m.message}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="rounded-2xl border border-gypsum bg-white p-5">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="display text-xl font-semibold text-navy">Son değişiklikler</h2>
            <Link href="/admin/gecmis" className="text-sm font-semibold text-smile-ink hover:underline">
              Tüm geçmiş →
            </Link>
          </div>
          {recentChanges.length === 0 ? (
            <p className="mt-3 text-sm text-slate">Kayıt yok.</p>
          ) : (
            <ul className="mt-3 divide-y divide-gypsum text-sm">
              {recentChanges.map((c) => (
                <li key={c.id} className="flex items-baseline gap-2 py-2">
                  <span className="min-w-0 flex-1 truncate">
                    <span className="font-semibold">{c.label || (c.table_name === "site_settings" ? "Site ayarları" : "(başlıksız)")}</span>{" "}
                    <span className="text-slate">{c.action === "INSERT" ? "eklendi" : c.action === "DELETE" ? "silindi" : "değişti"}</span>
                  </span>
                  <span className="hidden max-w-[10rem] truncate text-xs text-slate sm:inline">{c.actor_email}</span>
                  <span className="whitespace-nowrap text-xs text-slate">{formatTr(c.at)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

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

      <section className="mt-10 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Link href="/admin/slaytlar/yeni" className="rounded-2xl bg-navy p-6 text-white hover:bg-blue">
          <p className="display text-xl font-semibold">Yeni slayt ekle</p>
          <p className="mt-1 text-sm text-white/70">Anasayfadaki &quot;Laboratuvardan&quot; şeridinde görünür.</p>
        </Link>
        <Link href="/admin/duyurular/yeni" className="rounded-2xl border-2 border-navy bg-white p-6 text-navy hover:bg-porcelain">
          <p className="display text-xl font-semibold">Yeni duyuru ekle</p>
          <p className="mt-1 text-sm text-slate">Üst bant, açılır pencere ya da haber olarak.</p>
        </Link>
        <Link href="/admin/hikayeler/yeni" className="rounded-2xl border-2 border-navy bg-white p-6 text-navy hover:bg-porcelain">
          <p className="display text-xl font-semibold">Yeni hikâye ekle</p>
          <p className="mt-1 text-sm text-slate">Anasayfanın üstündeki yuvarlak hikâyeler.</p>
        </Link>
        <Link href="/admin/vakalar/yeni" className="rounded-2xl border-2 border-navy bg-white p-6 text-navy hover:bg-porcelain">
          <p className="display text-xl font-semibold">Yeni vaka ekle</p>
          <p className="mt-1 text-sm text-slate">Öncesi/sonrası görselli örnek iş.</p>
        </Link>
      </section>
    </>
  );
}
