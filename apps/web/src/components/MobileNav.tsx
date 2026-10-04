"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { NAV } from "./Sidebar";

type Tab = { label: string; href: string; icon: string };
const ICONS: Record<string, React.ReactNode> = {
  home: <path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />,
  chat: <path d="M4 5h16v11H8l-4 4z" />,
  megaphone: <path d="M3 10v4h3l7 4V6L6 10zM16 8.5a4 4 0 0 1 0 7" />,
  bell: <path d="M6 16V11a6 6 0 1 1 12 0v5l2 2H4zM10 20a2 2 0 0 0 4 0" />,
  inbox: <path d="M4 4h16v16H4zM4 14h5l1 2h4l1-2h5" />,
  menu: <path d="M4 6h16M4 12h16M4 18h16" />,
  users: <path d="M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21a7 7 0 0 1 14 0M17 11a3 3 0 1 0 0-6M22 21a6 6 0 0 0-5-6" />,
};
const Icon = ({ name }: { name: string }) => (
  <svg viewBox="0 0 24 24" className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {ICONS[name]}
  </svg>
);

export function MobileNav({ role, companyName, badges }: { role: string; companyName: string; badges: Record<string, number> }) {
  const path = usePathname();
  const [menu, setMenu] = useState(false);
  useEffect(() => setMenu(false), [path]);
  const employee = role === "employee";
  const canRequests = ["owner", "accountant", "hr", "branch_manager"].includes(role);
  const tabs: Tab[] = employee
    ? [
        { label: "Ana sayfa", href: "/benim", icon: "home" },
        { label: "Duyurular", href: "/duyurular", icon: "megaphone" },
        { label: "Mesajlar", href: "/mesajlar", icon: "chat" },
        { label: "Bildirimler", href: "/bildirimler", icon: "bell" },
      ]
    : [
        { label: "Panel", href: "/", icon: "home" },
        canRequests ? { label: "Talepler", href: "/talepler", icon: "inbox" } : { label: "Personel", href: "/personel", icon: "users" },
        { label: "Mesajlar", href: "/mesajlar", icon: "chat" },
        { label: "Bildirimler", href: "/bildirimler", icon: "bell" },
      ];
  const active = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));
  const groups = NAV.map((g) => ({ ...g, items: g.items.filter((i) => !i.roles || i.roles.includes(role)) })).filter((g) => g.items.length);
  const badge = (href: string) => badges[href] ?? 0;

  return (
    <>
      <header className="md:hidden print:hidden sticky top-0 z-30 bg-brand-900 text-white flex items-center gap-3 px-4 pb-2.5" style={{ paddingTop: "calc(env(safe-area-inset-top) + 10px)" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icon-192.png" alt="" className="w-8 h-8 rounded-lg" />
        <span className="font-display font-bold flex-1 truncate">{companyName.toUpperCase() || "MB DENTAL"}</span>
      </header>

      <nav aria-label="Alt menü" className="md:hidden print:hidden fixed bottom-0 inset-x-0 z-30 bg-white border-t border-line grid" style={{ gridTemplateColumns: `repeat(${tabs.length + 1}, 1fr)`, paddingBottom: "env(safe-area-inset-bottom)" }}>
        {tabs.map((t) => (
          <Link key={t.href} href={t.href} className={`relative flex flex-col items-center gap-0.5 py-2 text-[11px] font-semibold ${active(t.href) ? "text-brand-700" : "text-muted"}`}>
            <Icon name={t.icon} />
            {t.label}
            {badge(t.href) > 0 && (
              <span className="absolute top-1 left-1/2 ml-2 min-w-[18px] h-[18px] px-1 rounded-full bg-accent text-white text-[10px] font-bold grid place-items-center">{badge(t.href) > 99 ? "99+" : badge(t.href)}</span>
            )}
          </Link>
        ))}
        <button onClick={() => setMenu(true)} className={`flex flex-col items-center gap-0.5 py-2 text-[11px] font-semibold ${menu ? "text-brand-700" : "text-muted"}`} aria-haspopup="dialog">
          <Icon name="menu" />
          Menü
        </button>
      </nav>

      {menu && (
        <div className="md:hidden fixed inset-0 z-40" role="dialog" aria-modal="true" aria-label="Menü">
          <button className="absolute inset-0 bg-black/40" aria-label="Kapat" onClick={() => setMenu(false)} />
          <div className="absolute bottom-0 inset-x-0 bg-white rounded-t-2xl max-h-[80vh] overflow-y-auto p-4" style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 16px)" }}>
            <div className="w-10 h-1 rounded-full bg-line mx-auto mb-3" />
            {groups.map((g) => (
              <div key={g.group} className="mb-3">
                <div className="text-[11px] uppercase tracking-[0.08em] text-muted px-1 pb-1">{g.group}</div>
                <div className="grid grid-cols-2 gap-2">
                  {g.items.map((i) => (
                    <Link key={i.href} href={i.href} className={`rounded-xl px-3 py-3 text-sm font-semibold flex justify-between ${active(i.href) ? "bg-[#EAF2FB] text-brand-700" : "bg-ground text-ink"}`}>
                      {i.label}
                      {badge(i.href) > 0 && <span className="text-accent-ink">{badge(i.href)}</span>}
                    </Link>
                  ))}
                </div>
              </div>
            ))}
            <form action="/auth/signout" method="post">
              <button className="w-full h-11 rounded-xl border border-line text-bad font-semibold">Çıkış yap</button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
