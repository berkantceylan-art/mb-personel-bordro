import Link from "next/link";
import { headers } from "next/headers";
import { signOut } from "../giris/actions";
import { requireSiteEditor } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const NAV: { href: string; label: string; soon?: boolean }[] = [
  { href: "/admin", label: "Pano" },
  { href: "/admin/canli-destek", label: "Canlı destek" },
  { href: "/admin/gelen-kutusu", label: "Gelen kutusu" },
  { href: "/admin/portal/vakalar", label: "Portal vakaları" },
  { href: "/admin/portal", label: "Portal hesapları" },
  { href: "/admin/slaytlar", label: "Slaytlar" },
  { href: "/admin/hikayeler", label: "Hikâyeler" },
  { href: "/admin/duyurular", label: "Duyurular" },
  { href: "/admin/urunler", label: "Ürünler" },
  { href: "/admin/fiyat-listesi", label: "Fiyat listesi" },
  { href: "/admin/vakalar", label: "Vaka galerisi" },
  { href: "/admin/sayfalar", label: "Sayfalar" },
  { href: "/admin/sss", label: "Sıkça sorulanlar" },
  { href: "/admin/departmanlar", label: "Departmanlar" },
  { href: "/admin/ekip", label: "Çalışanlar" },
  { href: "/admin/medya", label: "Medya kütüphanesi" },
  { href: "/admin/ayarlar", label: "Site ayarları" },
  { href: "/admin/gecmis", label: "Değişiklik geçmişi" },
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
      <aside className="bg-navy text-white lg:sticky lg:top-0 lg:h-dvh">
        <div className="flex items-center gap-3 px-5 py-5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.svg" alt="" width={36} height={36} className="h-9 w-9" />
          <div>
            <p className="display font-semibold leading-tight">MB Dental</p>
            <p className="text-xs text-white/55">Site yönetimi</p>
          </div>
        </div>
        <nav aria-label="Yönetim" className="flex gap-1 overflow-x-auto px-3 pb-3 text-sm lg:flex-col lg:overflow-visible">
          {NAV.map((n) =>
            n.soon ? (
              <span key={n.label} className="flex shrink-0 items-center justify-between gap-2 rounded-lg px-3 py-2 text-white/35" title="Sıradaki fazlarda">
                {n.label}
                <span className="hidden text-[10px] lg:inline">yakında</span>
              </span>
            ) : (
              <Link
                key={n.href}
                href={n.href}
                aria-current={path === n.href || (n.href !== "/admin" && n.href !== "/admin/portal" && path.startsWith(`${n.href}/`)) || (n.href === "/admin/portal" && path.startsWith("/admin/portal/hesap")) ? "page" : undefined}
                className="shrink-0 rounded-lg px-3 py-2 text-white/85 hover:bg-white/10 hover:text-white aria-[current=page]:bg-white/15"
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
            ),
          )}
        </nav>
        <div className="border-t border-white/10 px-5 py-4 text-xs text-white/60 lg:absolute lg:bottom-0 lg:w-60">
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
