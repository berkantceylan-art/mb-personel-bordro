"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { SignOutForm } from "./SignOut";

import { NAV, activeHref, visibleNav } from "@/lib/nav";

export { NAV, activeHref, visibleNav };

export function Sidebar({ companyName, role, siteAccess = false, logistics = false, badges = {} }: { companyName: string; role: string; siteAccess?: boolean; logistics?: boolean; badges?: Record<string, number> }) {
  const path = usePathname();
  const groups = visibleNav(role, siteAccess, logistics);
  const current = activeHref(path);
  const isActive = (href: string) => href === current;
  return (
    <nav aria-label="Ana menü" className="print:hidden hidden md:flex md:w-62 md:shrink-0 bg-brand-900 text-[#C9D6E5] flex-col gap-5 px-3.5 py-5">
      <div className="flex items-center gap-3 px-2">
        <div className="w-11 h-11 rounded-[10px] bg-white grid place-items-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.svg" alt="" className="w-9 h-9 object-contain" />
        </div>
        <div className="flex flex-col">
          <span className="font-display font-bold text-white text-[15px] tracking-wide">{companyName.toUpperCase() || "MB DENTAL"}</span>
          <span className="text-xs text-[#8FA6BF]">ERP · İK, bordro ve tüm modüller</span>
        </div>
      </div>
      <div className="flex flex-col gap-1.5 overflow-y-auto min-h-0">
        {groups.map((g) => {
          const hub = `/modul/${g.slug}`;
          const onHub = path === hub;
          const open = g.slug === "genel" || g.slug === "benim" || groups.length <= 3 || onHub || g.items.some((n) => isActive(n.href));
          return (
            <details key={`${g.group}-${open}`} open={open} className="group/nav flex flex-col">
              <summary className={`list-none [&::-webkit-details-marker]:hidden cursor-pointer select-none flex items-center justify-between rounded-lg px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] hover:bg-white/5 hover:text-white ${onHub ? "bg-white/10 text-white" : "text-[#8FA6BF]"}`}>
                {g.slug === "genel" || g.slug === "benim" ? g.group : (
                  <Link href={hub} className="flex-1 hover:underline" title={`${g.group}: tüm işlemler`}>{g.group}</Link>
                )}
                <span className="flex items-center gap-1.5">
                  {(() => {
                    const n = g.items.reduce((a, i) => a + (badges[i.href] ?? 0), 0);
                    return n > 0 ? <span className="min-w-5 h-5 px-1.5 rounded-full bg-accent text-white text-[10px] font-bold grid place-items-center normal-case tracking-normal group-open/nav:hidden">{n > 99 ? "99+" : n}</span> : null;
                  })()}
                  <span aria-hidden="true" className="transition-transform group-open/nav:rotate-90">›</span>
                </span>
              </summary>
              <div className="mt-0.5 flex flex-col gap-0.5">
                {g.items.map((n) => n.raw ? (
                  <a key={n.href} href={n.href} className="px-3 py-2 rounded-lg whitespace-nowrap flex items-center justify-between gap-2 hover:bg-white/5">
                    {n.label} <span aria-hidden="true">↗</span>
                  </a>
                ) : (
                  <Link
                    key={n.href}
                    href={n.href}
                    className={`px-3 py-2 rounded-lg whitespace-nowrap flex items-center justify-between gap-2 ${isActive(n.href) ? "bg-brand-600 text-white font-semibold" : "hover:bg-white/5"}`}
                  >
                    {n.label}
                    {(badges[n.href] ?? 0) > 0 && (
                      <span className="min-w-5 h-5 px-1.5 rounded-full bg-accent text-white text-[11px] font-bold grid place-items-center" aria-label={`${badges[n.href]} okunmamış`}>
                        {badges[n.href]! > 99 ? "99+" : badges[n.href]}
                      </span>
                    )}
                  </Link>
                ))}
              </div>
            </details>
          );
        })}
      </div>
      <SignOutForm className="mt-auto px-1" buttonClassName="w-full text-left px-3 py-2.5 rounded-lg text-[#8FA6BF] hover:bg-white/5" />
    </nav>
  );
}
