"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AdminIcon } from "./admin/AdminIcon";

export type NavItem = { href: string; label: string; desc?: string };
export type NavGroup = { slug: string; title: string; short: string; items: NavItem[] };
type AdminItem = NavItem;
type AdminGroup = NavGroup;
export type RailLabels = {
  search: string; placeholder: string; favorites: string; favShort: string; favEmpty: string; recent: string; all: string;
  collapse: string; expand: string; menu: string; close: string; noResults: string; select: string; open: string; anywhere: string;
  addFav: string; removeFav: string; module: string;
};
export const TR_LABELS: RailLabels = {
  search: "Ara", placeholder: "Sayfa ara…", favorites: "Sık kullanılanlar", favShort: "Favori", favEmpty: "Bir sayfanın yanındaki yıldıza basın; burada hep elinizin altında olsun.",
  recent: "Son açılanlar", all: "Tümü", collapse: "Menüyü daralt", expand: "Menüyü genişlet", menu: "Menü", close: "Kapat", noResults: "Sonuç yok",
  select: "seç", open: "aç", anywhere: "her yerden aç", addFav: "sık kullanılanlara ekle", removeFav: "sık kullanılanlardan çıkar", module: "modülü",
};

/** Yol için en uzun eşleşen menü bağlantısı (kök bağlantı yalnız tam eşleşir) */
function activeFor(groups: NavGroup[], root: string, path: string): string | null {
  let best: string | null = null;
  for (const h of groups.flatMap((g) => g.items.map((i) => i.href))) {
    const hit = h === root ? path === root : path === h || path.startsWith(`${h}/`);
    if (hit && (!best || h.length > best.length)) best = h;
  }
  return best;
}
type Prefs = { fav: string[]; recent: string[]; collapsed: boolean };
const norm = (s: string) => s.toLocaleLowerCase("tr").replace(/ı/g, "i").replace(/ğ/g, "g").replace(/ü/g, "u").replace(/ş/g, "s").replace(/ö/g, "o").replace(/ç/g, "c");

function usePrefs(KEY: string) {
  const [p, setP] = useState<Prefs>({ fav: [], recent: [], collapsed: false });
  useEffect(() => {
    try {
      const v = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<Prefs> | null;
      if (v) setP({ fav: Array.isArray(v.fav) ? v.fav : [], recent: Array.isArray(v.recent) ? v.recent : [], collapsed: v.collapsed === true });
    } catch {
      /* özel pencere */
    }
  }, []);
  const update = useCallback((fn: (p: Prefs) => Prefs) => {
    setP((old) => {
      const next = fn(old);
      if (next === old) return old;
      try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* yok say */ }
      return next;
    });
  }, []);
  const toggleFav = useCallback((h: string) => update((o) => ({ ...o, fav: o.fav.includes(h) ? o.fav.filter((x) => x !== h) : [...o.fav, h] })), [update]);
  const visit = useCallback((h: string) => update((o) => (o.recent[0] === h ? o : { ...o, recent: [h, ...o.recent.filter((x) => x !== h)].slice(0, 8) })), [update]);
  const setCollapsed = useCallback((c: boolean) => update((o) => ({ ...o, collapsed: c })), [update]);
  return { ...p, toggleFav, visit, setCollapsed };
}

type Entry = AdminItem & { group: AdminGroup; hub?: boolean };

function Palette({ open, onClose, recent, groups, hubHref, L }: { open: boolean; onClose: () => void; recent: string[]; groups: NavGroup[]; hubHref?: (g: NavGroup) => string; L: RailLabels }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const entries = useMemo<Entry[]>(
    () => {
      const seen = new Set<string>();
      return groups.flatMap((g) => [
        ...(hubHref ? [{ href: hubHref(g), label: `${g.title} ${L.module}`, group: g, hub: true }] : []),
        ...g.items.filter((i) => (seen.has(i.href) ? false : (seen.add(i.href), true))).map((i) => ({ ...i, group: g })),
      ]);
    },
    [groups, hubHref, L.module],
  );
  const results = useMemo(() => {
    const nq = norm(q.trim());
    if (!nq) {
      const rec = recent.map((h) => entries.find((e) => e.href === h)).filter((e): e is Entry => !!e).slice(0, 5);
      return [...rec, ...entries.filter((e) => !e.hub && !recent.includes(e.href))].slice(0, 9);
    }
    const score = (e: Entry) => {
      const l = norm(e.label);
      if (l.startsWith(nq)) return 100;
      if (l.split(/\s+/).some((w) => w.startsWith(nq))) return 80;
      if (l.includes(nq)) return 60;
      const all = `${l} ${norm(e.group.title)} ${norm(e.desc ?? "")}`;
      return nq.split(/\s+/).every((w) => all.includes(w)) ? 40 : 0;
    };
    return entries.map((e) => ({ e, s: score(e) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).slice(0, 12).map((x) => x.e);
  }, [q, entries, recent]);
  useEffect(() => {
    if (open) { setQ(""); setSel(0); setTimeout(() => input.current?.focus(), 10); }
  }, [open]);
  useEffect(() => setSel(0), [q]);
  if (!open) return null;
  const go = (e: Entry) => { onClose(); router.push(e.href); };
  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center px-3 pt-[12vh]" role="dialog" aria-modal="true" aria-label={L.search}>
      <button className="absolute inset-0 bg-navy/60 backdrop-blur-sm" aria-label={L.close} onClick={onClose} />
      <div className="relative w-full max-w-[600px] overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center gap-3 border-b border-gypsum px-4">
          <AdminIcon name="search" className="h-5 w-5 text-slate" />
          <input
            ref={input}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(ev) => {
              if (ev.key === "ArrowDown") { ev.preventDefault(); setSel((s) => Math.min(s + 1, results.length - 1)); }
              else if (ev.key === "ArrowUp") { ev.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
              else if (ev.key === "Enter" && results[sel]) { ev.preventDefault(); go(results[sel]); }
              else if (ev.key === "Escape") onClose();
            }}
            placeholder={L.placeholder}
            className="h-14 flex-1 bg-transparent text-base text-ink outline-none placeholder:text-slate"
          />
          <kbd className="hidden rounded border border-gypsum px-1.5 py-0.5 text-[11px] text-slate sm:block">Esc</kbd>
        </div>
        <ul className="max-h-[52vh] overflow-y-auto p-2" role="listbox">
          {results.length === 0 && <li className="px-3 py-8 text-center text-slate">{L.noResults}</li>}
          {results.map((e, i) => (
            <li key={e.href} role="option" aria-selected={i === sel}>
              <button onMouseEnter={() => setSel(i)} onClick={() => go(e)} className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left ${i === sel ? "bg-smile/10" : ""}`}>
                <span className={`grid h-9 w-9 place-items-center rounded-lg ${i === sel ? "bg-navy text-white" : "bg-porcelain text-navy"}`}>
                  <AdminIcon name={!q && recent.includes(e.href) ? "clock" : e.group.slug} className="h-[18px] w-[18px]" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold text-ink">{e.label}</span>
                  <span className="block truncate text-xs text-slate">{e.group.title}{e.desc ? ` · ${e.desc}` : ""}</span>
                </span>
                {i === sel && <AdminIcon name="arrow" className="h-4 w-4 text-smile-ink" />}
              </button>
            </li>
          ))}
        </ul>
        <div className="hidden gap-4 border-t border-gypsum bg-porcelain px-4 py-2 text-[11px] text-slate sm:flex">
          <span>↑ ↓ {L.select}</span><span>Enter {L.open}</span><span>Ctrl / ⌘ + K {L.anywhere}</span>
        </div>
      </div>
    </div>
  );
}

/**
 * Modül rayı + sayfa paneli menüsü (site yönetimi ve hekim portalı ortak).
 * İkona basınca modül sayfası açılır, üzerine gelince panel önizler; Ctrl+K arama; yıldızla favoriler.
 */
export function RailNav({
  groups, root, badges, storageKey, brand, labels: L, hubBase, footer, cta, homeHref,
}: {
  groups: NavGroup[]; root: string; badges: Record<string, number>; storageKey: string; brand: string; labels: RailLabels;
  hubBase?: string; footer: React.ReactNode; cta?: { href: string; label: string }; homeHref: string;
}) {
  const path = usePathname();
  const hubHref = useMemo(() => (hubBase ? (g: NavGroup) => `${hubBase}/${g.slug}` : undefined), [hubBase]);
  const current = activeFor(groups, root, path);
  const prefs = usePrefs(storageKey);
  const railHref = (g: NavGroup) => (hubHref ? hubHref(g) : g.items[0]?.href ?? homeHref);
  const [palette, setPalette] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const activeSlug = groups.find((g) => hubHref && path === hubHref(g))?.slug ?? groups.find((g) => g.items.some((i) => i.href === current))?.slug ?? groups[0]?.slug ?? "";
  const { visit } = prefs;
  useEffect(() => {
    setPreview(null);
    setDrawer(false);
    if (current) visit(current);
  }, [current, path, visit]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setPalette((o) => !o); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const all = useMemo(() => { const m = new Map<string, { item: NavItem; group: NavGroup }>(); for (const g of groups) for (const i of g.items) if (!m.has(i.href)) m.set(i.href, { item: i, group: g }); return m; }, [groups]);
  const favs = prefs.fav.map((h) => all.get(h)).filter((x): x is NonNullable<typeof x> => !!x);
  const recents = prefs.recent.filter((h) => !prefs.fav.includes(h)).map((h) => all.get(h)).filter((x): x is NonNullable<typeof x> => !!x).slice(0, 5);
  const shown = preview ?? activeSlug;
  const favView = shown === "favoriler";
  const group = groups.find((g) => g.slug === shown);
  const groupBadge = (g: AdminGroup) => g.items.reduce((a, i) => a + (badges[i.href] ?? 0), 0);
  const collapsed = prefs.collapsed;
  const hover = (slug: string | null) => {
    if (timer.current) clearTimeout(timer.current);
    if (collapsed) return;
    timer.current = setTimeout(() => setPreview(slug), slug ? 140 : 250);
  };

  const Row = ({ item, from }: { item: AdminItem; from?: AdminGroup }) => {
    const on = item.href === current;
    const fav = prefs.fav.includes(item.href);
    const n = badges[item.href] ?? 0;
    return (
      <li className="group/row flex items-center gap-0.5">
        <Link href={item.href} aria-current={on ? "page" : undefined} className={`flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13.5px] ${on ? "bg-navy font-semibold text-white shadow-sm" : "text-ink hover:bg-porcelain"}`}>
          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${on ? "bg-smile" : "bg-gypsum group-hover/row:bg-blue"}`} />
          <span className="min-w-0 flex-1 truncate">
            {item.label}
            {from && <span className={`block truncate text-[11px] font-normal ${on ? "text-white/70" : "text-slate"}`}>{from.title}</span>}
          </span>
          {n > 0 && <span className="num grid h-5 min-w-5 place-items-center rounded-full bg-smile px-1.5 text-[11px] font-bold text-navy">{n}</span>}
        </Link>
        <button
          type="button"
          onClick={() => prefs.toggleFav(item.href)}
          className={`grid h-7 w-7 shrink-0 place-items-center rounded-md hover:bg-porcelain ${fav ? "text-[#E5A100]" : "text-slate opacity-0 focus:opacity-100 group-hover/row:opacity-100"}`}
          aria-label={`${item.label}: ${fav ? L.removeFav : L.addFav}`}
          title={fav ? L.removeFav : L.addFav}
        >
          <AdminIcon name="favoriler" className="h-4 w-4" filled={fav} />
        </button>
      </li>
    );
  };

  const Rail = ({ slug, label, href, onClick, badge = 0 }: { slug: string; label: string; href?: string; onClick?: () => void; badge?: number }) => {
    const active = activeSlug === slug;
    const cls = `relative flex w-[56px] flex-col items-center gap-1 rounded-xl py-2 text-[10px] font-semibold transition-colors ${active || shown === slug ? "bg-white/10 text-white" : "text-white/55 hover:bg-white/5 hover:text-white"}`;
    const inner = (
      <>
        {active && <span className="absolute -left-2 top-2 bottom-2 w-1 rounded-r-full bg-smile" />}
        <span className={`grid h-9 w-9 place-items-center rounded-[10px] ${active ? "bg-gradient-to-br from-smile to-blue text-white shadow-[0_4px_14px_-4px_rgba(43,196,238,.7)]" : ""}`}>
          <AdminIcon name={slug} filled={slug === "favoriler" && favView} />
        </span>
        <span className="max-w-full truncate px-0.5 leading-none">{label}</span>
        {badge > 0 && <span className="num absolute right-1.5 top-1 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-smile px-1 text-[10px] font-bold text-navy ring-2 ring-navy">{badge}</span>}
      </>
    );
    const common = { onMouseEnter: () => hover(slug), title: collapsed ? label : undefined, "aria-label": label };
    return href ? <Link href={href} className={cls} {...common}>{inner}</Link> : <button type="button" onClick={onClick} className={cls} {...common}>{inner}</button>;
  };

  const Panel = ({ mobile = false }: { mobile?: boolean }) => (
    <div className={`flex flex-col bg-white ${mobile ? "h-full w-full" : "w-[248px] border-r border-gypsum"}`}>
      <div className={`border-b border-gypsum px-4 pb-3 pt-4 ${mobile ? "pr-14" : ""}`}>
        <p className="truncate text-[11px] font-semibold uppercase tracking-[0.1em] text-slate">{brand}</p>
        {favView ? (
          <h2 className="display mt-1 text-lg font-semibold text-navy">{L.favorites}</h2>
        ) : group ? (
          <div className="mt-1 flex items-center justify-between gap-2">
            <h2 className="display text-lg font-semibold leading-tight text-navy">{group.title}</h2>
            {hubHref && <Link href={hubHref(group)} className="shrink-0 text-xs font-semibold text-smile-ink hover:underline">{L.all} →</Link>}
          </div>
        ) : null}
        <button type="button" onClick={() => setPalette(true)} className="mt-3 flex h-9 w-full items-center gap-2 rounded-lg border border-gypsum bg-porcelain px-2.5 text-[13px] text-slate hover:border-blue">
          <AdminIcon name="search" className="h-4 w-4" />
          <span className="flex-1 text-left">{L.search}…</span>
          <kbd className="rounded border border-gypsum bg-white px-1 text-[10px]">Ctrl K</kbd>
        </button>
        {cta && (
          <Link href={cta.href} className="mt-2 flex h-10 w-full items-center justify-center gap-1.5 rounded-lg bg-smile text-sm font-semibold text-navy hover:bg-navy hover:text-white">
            <AdminIcon name="plus" className="h-4 w-4" /> {cta.label}
          </Link>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {mobile && (
          <div className="mb-3 flex gap-1.5 overflow-x-auto pb-1">
            {[{ slug: "favoriler", title: L.favorites }, ...groups].map((g) => (
              <button key={g.slug} type="button" onClick={() => setPreview(g.slug)} className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold ${shown === g.slug ? "bg-navy text-white" : "bg-porcelain text-ink"}`}>{g.title}</button>
            ))}
          </div>
        )}
        {favView ? (
          <>
            {favs.length === 0 && <p className="px-3 py-3 text-[13px] text-slate">{L.favEmpty}</p>}
            <ul className="flex flex-col gap-0.5">{favs.map(({ item, group: g }) => <Row key={item.href} item={item} from={g} />)}</ul>
            {recents.length > 0 && (
              <>
                <p className="px-3 pb-1 pt-4 text-[11px] font-semibold uppercase tracking-wider text-slate">{L.recent}</p>
                <ul className="flex flex-col gap-0.5">{recents.map(({ item, group: g }) => <Row key={item.href} item={item} from={g} />)}</ul>
              </>
            )}
          </>
        ) : group ? (
          <ul className="flex flex-col gap-0.5">{group.items.map((i) => <Row key={i.href} item={i} />)}</ul>
        ) : null}
        {!favView && favs.length > 0 && (
          <>
            <p className="flex items-center gap-1.5 px-3 pb-1 pt-5 text-[11px] font-semibold uppercase tracking-wider text-slate"><AdminIcon name="favoriler" className="h-3 w-3" filled /> {L.favorites}</p>
            <ul className="flex flex-col gap-0.5">{favs.slice(0, 6).map(({ item, group: g }) => <Row key={`f-${item.href}`} item={item} from={g} />)}</ul>
          </>
        )}
      </div>
      <div className="border-t border-gypsum p-3 text-xs text-slate">{footer}</div>
    </div>
  );

  return (
    <>
      {/* Masaüstü */}
      <nav aria-label={brand} className="sticky top-0 hidden h-dvh shrink-0 lg:flex" onMouseLeave={() => hover(null)}>
        <div className="flex w-[72px] flex-col items-center gap-1 bg-navy bg-[radial-gradient(120%_60%_at_0%_0%,rgba(43,196,238,.2),transparent_60%)] py-3">
          <Link href={homeHref} className="mb-2 grid h-11 w-11 place-items-center rounded-[12px] bg-white shadow-lg" aria-label={brand}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.svg" alt="" className="h-8 w-8" />
          </Link>
          <button type="button" onClick={() => setPalette(true)} className="mb-1 grid h-10 w-[56px] place-items-center rounded-xl bg-white/5 text-white/80 hover:bg-white/10 hover:text-white" aria-label={`${L.search} (Ctrl+K)`} title={`${L.search} (Ctrl+K)`}>
            <AdminIcon name="search" />
          </button>
          <Rail slug="favoriler" label={L.favShort} onClick={() => { if (collapsed) prefs.setCollapsed(false); setPreview("favoriler"); }} />
          <span className="my-1 h-px w-8 bg-white/10" />
          <div className="flex w-full min-h-0 flex-1 flex-col items-center gap-1 overflow-y-auto [scrollbar-width:none]">
            {groups.map((g) => <Rail key={g.slug} slug={g.slug} label={g.short} href={railHref(g)} badge={groupBadge(g)} />)}
          </div>
          {cta && (
            <Link href={cta.href} className="mb-1 grid h-10 w-[56px] place-items-center rounded-xl bg-smile text-navy hover:bg-white" aria-label={cta.label} title={cta.label}>
              <AdminIcon name="plus" />
            </Link>
          )}
          <button type="button" onClick={() => prefs.setCollapsed(!collapsed)} className="grid h-10 w-[56px] place-items-center rounded-xl text-white/55 hover:bg-white/5 hover:text-white" aria-label={collapsed ? L.expand : L.collapse} title={collapsed ? L.expand : L.collapse}>
            <AdminIcon name={collapsed ? "expand" : "collapse"} />
          </button>
        </div>
        {!collapsed && <Panel />}
      </nav>

      {/* Mobil üst çubuk + çekmece */}
      <header className="sticky top-0 z-40 flex items-center gap-3 bg-navy px-4 py-3 text-white lg:hidden">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.svg" alt="" width={32} height={32} className="h-8 w-8" />
        <span className="display flex-1 truncate font-semibold">{all.get(current ?? "")?.item.label ?? brand}</span>
        <button type="button" onClick={() => setPalette(true)} className="grid h-10 w-10 place-items-center rounded-full hover:bg-white/10" aria-label={L.search}><AdminIcon name="search" className="h-6 w-6" /></button>
        <button type="button" onClick={() => setDrawer(true)} className="relative grid h-10 w-10 place-items-center rounded-full hover:bg-white/10" aria-label={L.menu} aria-haspopup="dialog">
          <AdminIcon name="menu" className="h-6 w-6" />
          {Object.values(badges).some((n) => n > 0) && <span className="absolute right-1.5 top-1.5 h-2.5 w-2.5 rounded-full bg-smile ring-2 ring-navy" />}
        </button>
      </header>
      {drawer && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label={L.menu}>
          <button className="absolute inset-0 bg-navy/50" aria-label={L.close} onClick={() => setDrawer(false)} />
          <div className="absolute inset-y-0 right-0 flex w-[88%] max-w-sm flex-col shadow-2xl">
            <button type="button" onClick={() => setDrawer(false)} className="absolute right-3 top-3 z-10 grid h-9 w-9 place-items-center rounded-full bg-porcelain text-navy" aria-label={L.close}><AdminIcon name="close" className="h-5 w-5" /></button>
            <Panel mobile />
          </div>
        </div>
      )}
      <Palette open={palette} onClose={() => setPalette(false)} recent={prefs.recent} groups={groups} hubHref={hubHref} L={L} />
    </>
  );
}
