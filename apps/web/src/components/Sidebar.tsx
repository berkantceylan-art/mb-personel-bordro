"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { NAV, activeHref, visibleNav, type Group, type Item } from "@/lib/nav";
import { useNavPrefs } from "@/lib/nav-prefs";
import { CommandPalette } from "./CommandPalette";
import { NavIcon } from "./NavIcon";
import { SignOutForm } from "./SignOut";

export { NAV, activeHref, visibleNav };

/** Grubun ana sayfası: modül sayfası; Genel ve Benim sayfam için ilk sayfa */
export const hubHref = (g: Group) => (g.slug === "genel" || g.slug === "benim" ? g.items[0]?.href ?? "/" : `/modul/${g.slug}`);
const short = (g: Group) =>
  ({ genel: "Genel", benim: "Benim", "insan-kaynaklari": "İK", "puantaj-izin": "Puantaj", "muhasebe-bordro": "Bordro", cari: "Cari", laboratuvar: "Lab", lojistik: "Kargo", finans: "Finans", stok: "Stok", "alis-satis": "Alış-satış", uretim: "Üretim", masraf: "Masraf", demirbas: "Demirbaş", "isg-uyum": "İSG", raporlar: "Rapor", "web-sitesi": "Site", sistem: "Sistem" })[g.slug] ?? g.group;

/** Ctrl+K kısayolu ve arama penceresi (masaüstü ve mobil menü ortak) */
export function useCommandK() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return [open, setOpen] as const;
}

/**
 * Masaüstü menü: solda modül ikonları (ray), yanında seçili modülün sayfaları (panel).
 * İkona basınca modül sayfası açılır; üzerine gelince panel o modülü önizler.
 * Ctrl+K hızlı arama, yıldızla sık kullanılanlar, son açılanlar, daraltılabilir panel.
 */
export function Sidebar({ companyName, role, siteAccess = false, logistics = false, modules = {}, badges = {} }: { companyName: string; role: string; siteAccess?: boolean; logistics?: boolean; modules?: Record<string, number>; badges?: Record<string, number> }) {
  const path = usePathname();
  const groups = useMemo(() => visibleNav(role, siteAccess, logistics, modules), [role, siteAccess, logistics, modules]);
  const current = activeHref(path);
  const prefs = useNavPrefs();
  const [paletteOpen, setPaletteOpen] = useCommandK();
  const [last, setLast] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Bulunulan sayfanın modülü (aynı sayfa iki modülde varsa son seçilen tercih edilir)
  const activeSlug = useMemo(() => {
    const hub = path.match(/^\/modul\/([a-z-]+)/)?.[1];
    if (hub) return hub;
    const owners = groups.filter((g) => g.items.some((i) => i.href === current));
    return (owners.find((g) => g.slug === last) ?? owners[0])?.slug ?? groups[0]?.slug ?? "genel";
  }, [path, current, groups, last]);

  const { visit } = prefs;
  useEffect(() => {
    setLast(activeSlug);
    setPreview(null);
    if (current && current !== "/") visit(current);
  }, [activeSlug, current, visit]);

  const all = useMemo(() => {
    const m = new Map<string, { item: Item; group: Group }>();
    for (const g of groups) for (const i of g.items) if (!m.has(i.href)) m.set(i.href, { item: i, group: g });
    return m;
  }, [groups]);

  const shown = preview ?? activeSlug;
  const favView = shown === "favoriler";
  const group = groups.find((g) => g.slug === shown);
  const favItems = prefs.fav.map((h) => all.get(h)).filter((x): x is NonNullable<typeof x> => !!x);
  const recentItems = prefs.recent.filter((h) => !prefs.fav.includes(h)).map((h) => all.get(h)).filter((x): x is NonNullable<typeof x> => !!x).slice(0, 5);
  const groupBadge = (g: Group) => g.items.reduce((a, i) => a + (badges[i.href] ?? 0), 0);
  const collapsed = prefs.collapsed;

  const hover = (slug: string | null) => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    if (collapsed) return;
    hoverTimer.current = setTimeout(() => setPreview(slug), slug ? 140 : 250);
  };

  const ItemRow = ({ item, from }: { item: Item; from?: Group }) => {
    const active = item.href === current;
    const fav = prefs.fav.includes(item.href);
    const n = badges[item.href] ?? 0;
    const cls = `flex-1 min-w-0 flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13.5px] ${active ? "bg-brand-700 text-white font-semibold shadow-sm" : "text-ink hover:bg-ground"}`;
    const body = (
      <>
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${active ? "bg-accent" : "bg-line group-hover/row:bg-brand-600"}`} />
        <span className="flex-1 min-w-0 truncate">
          {item.label}
          {from && <span className={`block text-[11px] font-normal truncate ${active ? "text-white/70" : "text-muted"}`}>{from.group}</span>}
        </span>
        {n > 0 && <span className="min-w-5 h-5 px-1.5 rounded-full bg-accent text-white text-[11px] font-bold grid place-items-center">{n > 99 ? "99+" : n}</span>}
        {item.raw && <span aria-hidden="true">↗</span>}
      </>
    );
    return (
      <li className="group/row flex items-center gap-0.5">
        {item.raw ? <a href={item.href} className={cls}>{body}</a> : <Link href={item.href} className={cls} aria-current={active ? "page" : undefined}>{body}</Link>}
        <button
          type="button"
          onClick={() => prefs.toggleFav(item.href)}
          className={`shrink-0 w-7 h-7 grid place-items-center rounded-md ${fav ? "text-[#E5A100]" : "text-muted opacity-0 group-hover/row:opacity-100 focus:opacity-100"} hover:bg-ground`}
          aria-label={fav ? `${item.label}: sık kullanılanlardan çıkar` : `${item.label}: sık kullanılanlara ekle`}
          title={fav ? "Sık kullanılanlardan çıkar" : "Sık kullanılanlara ekle"}
        >
          <NavIcon name="favoriler" className="w-4 h-4" filled={fav} />
        </button>
      </li>
    );
  };

  const RailButton = ({ slug, label, icon, href, badge = 0, onClick }: { slug: string; label: string; icon: string; href?: string; badge?: number; onClick?: () => void }) => {
    const on = activeSlug === slug && !favView ? true : shown === slug;
    const cls = `relative w-[56px] flex flex-col items-center gap-1 rounded-xl py-2 text-[10px] font-semibold transition-colors ${
      on ? "bg-white/12 text-white" : "text-[#8FA6BF] hover:bg-white/6 hover:text-white"
    }`;
    const inner = (
      <>
        {activeSlug === slug && <span className="absolute -left-2 top-2 bottom-2 w-1 rounded-r-full bg-accent" />}
        <span className={`grid place-items-center w-9 h-9 rounded-[10px] ${activeSlug === slug ? "bg-gradient-to-br from-accent to-brand-600 text-white shadow-[0_4px_14px_-4px_rgba(0,166,214,.7)]" : ""}`}>
          <NavIcon name={icon} className="w-5 h-5" filled={icon === "favoriler" && favView} />
        </span>
        <span className="max-w-full truncate px-0.5 leading-none">{label}</span>
        {badge > 0 && <span className="absolute top-1 right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-accent text-white text-[10px] font-bold grid place-items-center ring-2 ring-brand-900">{badge > 99 ? "99+" : badge}</span>}
      </>
    );
    const common = { onMouseEnter: () => hover(slug), title: collapsed ? label : undefined, "aria-label": label };
    return href ? (
      <Link href={href} className={cls} {...common} aria-current={activeSlug === slug ? "page" : undefined}>{inner}</Link>
    ) : (
      <button type="button" onClick={onClick} className={cls} {...common}>{inner}</button>
    );
  };

  return (
    <>
      <nav aria-label="Ana menü" className="print:hidden hidden md:flex sticky top-0 h-screen shrink-0 z-20" onMouseLeave={() => hover(null)}>
        {/* Modül rayı */}
        <div className="w-[72px] bg-brand-900 bg-[radial-gradient(120%_60%_at_0%_0%,rgba(0,166,214,.18),transparent_60%)] flex flex-col items-center gap-1 py-3">
          <Link href={groups[0] ? hubHref(groups[0]) : "/"} className="mb-2 w-11 h-11 rounded-[12px] bg-white grid place-items-center shadow-lg" aria-label={companyName || "MB Dental"} title={companyName || "MB Dental"}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.svg" alt="" className="w-8 h-8 object-contain" />
          </Link>
          <button type="button" onClick={() => setPaletteOpen(true)} className="w-[56px] h-10 mb-1 rounded-xl grid place-items-center text-[#C9D6E5] bg-white/6 hover:bg-white/12 hover:text-white" aria-label="Ara (Ctrl+K)" title="Ara (Ctrl+K)">
            <NavIcon name="search" />
          </button>
          <RailButton slug="favoriler" label="Favori" icon="favoriler" onClick={() => { if (collapsed) prefs.setCollapsed(false); setPreview("favoriler"); }} />
          <span className="w-8 h-px bg-white/10 my-1" />
          <div className="flex-1 min-h-0 w-full overflow-y-auto flex flex-col items-center gap-1 [scrollbar-width:none]">
            {groups.map((g) => <RailButton key={g.slug} slug={g.slug} label={short(g)} icon={g.slug} href={hubHref(g)} badge={groupBadge(g)} />)}
          </div>
          <button
            type="button"
            onClick={() => prefs.setCollapsed(!collapsed)}
            className="mt-1 w-[56px] h-10 rounded-xl grid place-items-center text-[#8FA6BF] hover:bg-white/6 hover:text-white"
            aria-label={collapsed ? "Menüyü genişlet" : "Menüyü daralt"}
            title={collapsed ? "Menüyü genişlet" : "Menüyü daralt"}
          >
            <NavIcon name={collapsed ? "expand" : "collapse"} />
          </button>
        </div>

        {/* Sayfa paneli */}
        {!collapsed && (
          <div className="w-[248px] bg-white border-r border-line flex flex-col">
            <div className="px-4 pt-4 pb-3 border-b border-line">
              <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted truncate">{(companyName || "MB Dental").toUpperCase()} · ERP</p>
              {favView ? (
                <h2 className="mt-1 font-display text-lg font-bold text-brand-800">Sık kullanılanlar</h2>
              ) : group ? (
                <div className="mt-1 flex items-center justify-between gap-2">
                  <h2 className="font-display text-lg font-bold text-brand-800 leading-tight">{group.group}</h2>
                  {group.slug !== "genel" && group.slug !== "benim" && (
                    <Link href={`/modul/${group.slug}`} className="shrink-0 text-[12px] font-semibold text-brand-600 hover:underline" title="Modülün tüm işlemleri">Tümü →</Link>
                  )}
                </div>
              ) : null}
              <button type="button" onClick={() => setPaletteOpen(true)} className="mt-3 w-full h-9 flex items-center gap-2 rounded-lg border border-line bg-ground px-2.5 text-[13px] text-muted hover:border-brand-600">
                <NavIcon name="search" className="w-4 h-4" />
                <span className="flex-1 text-left">Ara…</span>
                <kbd className="text-[10px] border border-line bg-white rounded px-1">Ctrl K</kbd>
              </button>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto px-2 py-2">
              {favView ? (
                <>
                  {favItems.length === 0 && (
                    <p className="px-3 py-3 text-[13px] text-muted">Bir sayfanın yanındaki yıldıza basın; burada hep elinizin altında olsun.</p>
                  )}
                  <ul className="flex flex-col gap-0.5">{favItems.map(({ item, group: g }) => <ItemRow key={item.href} item={item} from={g} />)}</ul>
                  {recentItems.length > 0 && (
                    <>
                      <p className="px-3 pt-4 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted">Son açılanlar</p>
                      <ul className="flex flex-col gap-0.5">{recentItems.map(({ item, group: g }) => <ItemRow key={item.href} item={item} from={g} />)}</ul>
                    </>
                  )}
                </>
              ) : group ? (
                <ul className="flex flex-col gap-0.5">{group.items.map((i) => <ItemRow key={i.href} item={i} />)}</ul>
              ) : null}
              {!favView && favItems.length > 0 && (
                <>
                  <p className="px-3 pt-5 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted flex items-center gap-1.5">
                    <NavIcon name="favoriler" className="w-3 h-3" filled /> Sık kullanılanlar
                  </p>
                  <ul className="flex flex-col gap-0.5">{favItems.slice(0, 6).map(({ item, group: g }) => <ItemRow key={`f-${item.href}`} item={item} from={g} />)}</ul>
                </>
              )}
            </div>
            <a href="/auth/sifre-yenile" className="border-t border-line mx-2 mt-1 flex items-center gap-2 rounded-lg px-3 py-2 text-[13px] text-muted hover:bg-ground hover:text-ink">Şifremi değiştir</a>
            <SignOutForm className="p-2 pt-0" buttonClassName="w-full flex items-center gap-2 rounded-lg px-3 py-2 text-[13px] text-muted hover:bg-ground hover:text-bad" />
          </div>
        )}
      </nav>
      <CommandPalette groups={groups} open={paletteOpen} onClose={() => setPaletteOpen(false)} recent={prefs.recent} />
    </>
  );
}
