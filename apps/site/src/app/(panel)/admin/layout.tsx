import Link from "next/link";
import { headers } from "next/headers";
import { signOut } from "../giris/actions";
import { requireSiteEditor } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type NavItem = { href: string; label: string };
const NAV: { title: string; items: NavItem[] }[] = [
  {
    title: "Genel",
    items: [
      { href: "/admin", label: "Pano" },
      { href: "/admin/canli-destek", label: "Canlı destek" },
      { href: "/admin/gelen-kutusu", label: "Gelen kutusu" },
    ],
  },
  {
    title: "Portal",
    items: [
      { href: "/admin/portal/vakalar", label: "Portal vakaları" },
      { href: "/admin/portal", label: "Portal hesapları" },
      { href: "/admin/fiyat-listesi", label: "Fiyat listesi" },
    ],
  },
  {
    title: "Site içeriği",
    items: [
      { href: "/admin/slaytlar", label: "Slaytlar" },
      { href: "/admin/hikayeler", label: "Hikâyeler" },
      { href: "/admin/duyurular", label: "Duyurular" },
      { href: "/admin/urunler", label: "Ürünler" },
      { href: "/admin/vakalar", label: "Vaka galerisi" },
      { href: "/admin/sayfalar", label: "Sayfalar" },
      { href: "/admin/sss", label: "Sıkça sorulanlar" },
    ],
  },
  {
    title: "Kurumsal",
    items: [
      { href: "/admin/departmanlar", label: "Departmanlar" },
      { href: "/admin/ekip", label: "Çalışanlar" },
    ],
  },
  {
    title: "Sistem",
    items: [
      { href: "/admin/medya", label: "Medya kütüphanesi" },
      { href: "/admin/ayarlar", label: "Site ayarları" },
      { href: "/admin/gecmis", label: "Değişiklik geçmişi" },
    ],
  },
];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requireSiteEditor();
  const path = (await headers()).get("x-pathname") ?? "";
  const supabase = await createClient();
  const [{ data: unread }, { data: pendingAcc }, { data: chats }, { data: priceReq }] = await Promise.all([
    supabase.rpc("cms_unread_messages"),
    supabase.rpc("portal_pending_count"),
    supabase.rpc("cms_unread_chats"),
    supabase.rpc("portal_price_requests_count"),
  ]);
  const unreadCount = typeof unread === "number" ? unread : 0;
  const pendingCount = (typeof pendingAcc === "number" ? pendingAcc : 0) + (typeof priceReq === "number" ? priceReq : 0);
  const badge: Record<string, number> = {
    "/admin/gelen-kutusu": unreadCount,
    "/admin/portal": pendingCount,
    "/admin/canli-destek": typeof chats === "number" ? chats : 0,
  };
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[15rem_1fr]">
      <aside className="bg-navy text-white lg:sticky lg:top-0 lg:flex lg:h-dvh lg:flex-col">
        <div className="flex shrink-0 items-center gap-3 px-5 py-5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.svg" alt="" width={36} height={36} className="h-9 w-9" />
          <div>
            <p className="display font-semibold leading-tight">MB Dental</p>
            <p className="text-xs text-white/55">Site yönetimi</p>
          </div>
        </div>
        <nav aria-label="Yönetim" className="admin-nav flex gap-1 overflow-x-auto px-3 pb-3 text-sm lg:min-h-0 lg:flex-1 lg:flex-col lg:gap-0 lg:overflow-y-auto lg:overflow-x-visible">
          {NAV.map((group) => (
            <div key={group.title} className="contents lg:mb-3 lg:block">
              <p className="hidden px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-white/40 lg:block">{group.title}</p>
              {group.items.map((n) => (
                <Link
                  key={n.href}
                  href={n.href}
                  aria-current={path === n.href || (n.href !== "/admin" && n.href !== "/admin/portal" && path.startsWith(`${n.href}/`)) || (n.href === "/admin/portal" && path.startsWith("/admin/portal/hesap")) ? "page" : undefined}
                  className="block shrink-0 rounded-lg px-3 py-2 text-white/85 hover:bg-white/10 hover:text-white aria-[current=page]:bg-white/15 lg:py-1.5"
                >
                  <span className="flex items-center justify-between gap-2">
                    {n.label}
                    {(badge[n.href] ?? 0) > 0 && (
                      <span className="num rounded-full bg-smile px-2 py-0.5 text-[11px] font-bold text-navy" aria-label={`${badge[n.href]} bekleyen`}>
                        {badge[n.href]}
                      </span>
                    )}
                  </span>
                </Link>
              ))}
            </div>
          ))}
        </nav>
        <div className="shrink-0 border-t border-white/10 px-5 py-4 text-xs text-white/60">
          <p className="truncate">{user.email}</p>
          <div className="mt-2 flex gap-3">
            <Link href="/tr" className="hover:text-white" target="_blank">
              Siteyi aç
            </Link>
            <form action={signOut}>
              <button type="submit" className="hover:text-white">
                Çıkış
              </button>
            </form>
          </div>
        </div>
      </aside>
      <main className="min-w-0 px-4 py-8 sm:px-8 lg:py-10">{children}</main>
    </div>
  );
}
