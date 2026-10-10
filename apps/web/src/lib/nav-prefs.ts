"use client";
import { useCallback, useEffect, useState } from "react";

/** Menü tercihleri bu cihazda saklanır: sık kullanılanlar, son açılanlar, dar menü */
const KEY = "mb-nav-v1";
type Prefs = { fav: string[]; recent: string[]; collapsed: boolean };
const EMPTY: Prefs = { fav: [], recent: [], collapsed: false };

function read(): Prefs {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<Prefs> | null;
    return { fav: Array.isArray(v?.fav) ? v.fav.slice(0, 20) : [], recent: Array.isArray(v?.recent) ? v.recent.slice(0, 8) : [], collapsed: v?.collapsed === true };
  } catch {
    return EMPTY;
  }
}

export function useNavPrefs() {
  const [prefs, setPrefs] = useState<Prefs>(EMPTY);
  useEffect(() => setPrefs(read()), []);
  const update = useCallback((fn: (p: Prefs) => Prefs) => {
    setPrefs((p) => {
      const next = fn(p);
      if (next === p) return p;
      try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* özel pencere */ }
      return next;
    });
  }, []);
  const toggleFav = useCallback((href: string) => update((p) => ({ ...p, fav: p.fav.includes(href) ? p.fav.filter((h) => h !== href) : [...p.fav, href] })), [update]);
  const visit = useCallback((href: string) => update((p) => (p.recent[0] === href ? p : { ...p, recent: [href, ...p.recent.filter((h) => h !== href)].slice(0, 8) })), [update]);
  const setCollapsed = useCallback((collapsed: boolean) => update((p) => ({ ...p, collapsed })), [update]);
  return { ...prefs, toggleFav, visit, setCollapsed };
}
