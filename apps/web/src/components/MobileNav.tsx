"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { NAV } from "./Sidebar";
import { SignOutForm } from "./SignOut";

type Tab = { label: string; href: string; icon: string };
const ICONS: Record<string, React.ReactNode> = {
  home: <path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />,
  chat: <path d="M4 5h16v11H8l-4 4z" />,
  megaphone: <path d="M3 10v4h3l7 4V6L6 10zM16 8.5a4 4 0 0 1 0 7" />,
  bell: <path d="M6 16V11a6 6 0 1 1 12 0v5l2 2H4zM10 20a2 2 0 0 0 4 0" />,
  inbox: <path d="M4 4h16v16H4zM4 14h5l1 2h4l1-2h5" />,
  menu: <path d="M4 6h16M4 12h16M4 18h16" />,
  users: <path d="M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21a7 7 0 0 1 14 0M17 11a3 3 0 1 0 0-6M22 21a6 6 0 0 0-5-6" />,
  money: <path d="M3 7h18v10H3zM12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5M6 10h.01M18 14h.01" />,
  calendar: <path d="M4 6h16v14H4zM4 10h16M8 3v4M16 3v4M9 14h2M13 14h2" />,
  doc: <path d="M6 3h8l4 4v14H6zM14 3v4h4M9 12h6M9 16h6" />,
  list: <path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" />,
  clock: <path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2" />,
  id: <path d="M3 5h18v14H3zM7 14a3 3 0 0 1 6 0M10 8a2 2 0 1 0 0 4 2 2 0 0 0 0-4M15 9h4M15 13h4" />,
  folder: <path d="M3 6h6l2 2h10v12H3zM3 10h18" />,
  shield: <path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6zM9 12l2 2 4-4" />,
  crown: <path d="M3 18h18M4 16l1-9 5 4 2-6 2 6 5-4 1 9z" />,
  gear: <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />,
  pen: <path d="M4 20h4l10-10-4-4L4 16zM13 7l4 4M3 21h18" />,
  box: <path d="M3 8l9-5 9 5v8l-9 5-9-5zM3 8l9 5 9-5M12 13v8" />,
  piggy: <path d="M5 11a7 6 0 0 1 14 0v3h2v-4M5 14v4M9 17v3M15 17v3M14 9h.01M19 14a2 2 0 0 0 0-4" />,
  gavel: <path d="M14 4l6 6-3 3-6-6zM11 7l-7 7 3 3 7-7M3 21h10" />,
  mail: <path d="M3 6h18v12H3zM3 7l9 6 9-6" />,
  lock: <path d="M6 11h12v10H6zM8 11V7a4 4 0 0 1 8 0v4M12 15v2" />,
  flag: <path d="M5 21V4M5 4h11l-2 4 2 4H5" />,
  star: <path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z" />,
  target: <path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 12h.01" />,
  briefcase: <path d="M3 8h18v12H3zM9 8V5h6v3M3 13h18" />,
  sitemap: <path d="M10 3h4v4h-4zM4 17h4v4H4zM16 17h4v4h-4zM12 7v5M6 17v-5h12v5" />,
  heart: <path d="M12 21s-8-5.5-8-11a4 4 0 0 1 8-1 4 4 0 0 1 8 1c0 5.5-8 11-8 11z" />,
};
export const MenuIcon = ({ name }: { name: string }) => (
  <svg viewBox="0 0 24 24" className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {ICONS[name]}
  </svg>
);
const Icon = ({ name }: { name: string }) => (
  <svg viewBox="0 0 24 24" className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {ICONS[name]}
  </svg>
);

export function MobileNav({ role, companyName, badges, boss = false }: { role: string; companyName: string; badges: Record<string, number>; boss?: boolean }) {
  const path = usePathname();
  const [menu, setMenu] = useState(false);
  useEffect(() => setMenu(false), [path]);
  const employee = role === "employee";
  const canRequests = ["owner", "accountant", "hr", "branch_manager"].includes(role);
  const tabs: Tab[] = employee
    ? [
        { label: "Ana sayfa", href: "/benim", icon: "home" },
        { label: "Avans", href: "/benim/avans", icon: "money" },
        { label: "İzin", href: "/benim/izin", icon: "calendar" },
        { label: "Mesajlar", href: "/mesajlar", icon: "chat" },
        { label: "Bildirimler", href: "/bildirimler", icon: "bell" },
      ]
    : [
        ...(boss ? [{ label: "Patron", href: "/patron", icon: "crown" }] : [{ label: "Panel", href: "/", icon: "home" }]),
        canRequests ? { label: "Talepler", href: "/talepler", icon: "inbox" } : { label: "Personel", href: "/personel", icon: "users" },
        { label: "Mesajlar", href: "/mesajlar", icon: "chat" },
        { label: "Bildirimler", href: "/bildirimler", icon: "bell" },
      ];
  const active = (href: string) => (href === "/" ? path === "/" : href === "/benim" ? path === "/benim" : path.startsWith(href));
  const groups = NAV.map((g) => ({ ...g, items: g.items.filter((i) => !i.roles || i.roles.includes(role)) })).filter((g) => g.items.length);
  const badge = (href: string) => badges[href] ?? 0;

  return (
    <>
      <header className="md:hidden print:hidden sticky top-0 z-30 bg-brand-900 text-white flex items-center gap-3 px-4 pb-2.5" style={{ paddingTop: "calc(env(safe-area-inset-top) + 10px)" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.svg" alt="" className="w-8 h-8" />
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
            <SignOutForm buttonClassName="w-full h-11 rounded-xl border border-line text-bad font-semibold" />
          </div>
        </div>
      )}
    </>
  );
}
