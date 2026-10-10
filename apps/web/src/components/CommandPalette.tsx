"use client";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Group } from "@/lib/nav";
import { NavIcon } from "./NavIcon";

/** Türkçe karakterleri sadeleştirir: "İş kayıt" → "is kayit" */
export const norm = (s: string) =>
  s.toLocaleLowerCase("tr").replace(/ı/g, "i").replace(/ğ/g, "g").replace(/ü/g, "u").replace(/ş/g, "s").replace(/ö/g, "o").replace(/ç/g, "c");

type Entry = { label: string; href: string; group: string; slug: string; desc?: string; raw?: boolean; hub?: boolean };

function score(e: Entry, q: string) {
  if (!q) return 1;
  const l = norm(e.label);
  const all = `${l} ${norm(e.group)} ${norm(e.desc ?? "")}`;
  if (l.startsWith(q)) return 100;
  if (l.split(/[\s/]+/).some((w) => w.startsWith(q))) return 80;
  if (l.includes(q)) return 60;
  const words = q.split(/\s+/).filter(Boolean);
  if (words.every((w) => all.includes(w))) return 40;
  // harf sırasıyla eşleşme (ör. "iskyt" → "iş kayıt")
  let i = 0;
  for (const ch of l) if (ch === q[i]) i++;
  return i === q.length ? 20 : 0;
}

/** Ctrl+K / ⌘K ile açılan hızlı arama: tüm yetkili sayfalara klavyeyle git */
export function CommandPalette({ groups, open, onClose, recent }: { groups: Group[]; open: boolean; onClose: () => void; recent: string[] }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);

  const entries = useMemo<Entry[]>(() => {
    const out: Entry[] = [];
    const seen = new Set<string>();
    for (const g of groups) {
      if (g.slug !== "genel" && g.slug !== "benim") out.push({ label: `${g.group} modülü`, href: `/modul/${g.slug}`, group: g.group, slug: g.slug, hub: true });
      for (const i of g.items) {
        if (seen.has(i.href)) continue;
        seen.add(i.href);
        out.push({ label: i.label, href: i.href, group: g.group, slug: g.slug, desc: i.desc, raw: i.raw });
      }
    }
    return out;
  }, [groups]);

  const results = useMemo(() => {
    const nq = norm(q.trim());
    if (!nq) {
      const rec = recent.map((h) => entries.find((e) => e.href === h)).filter((e): e is Entry => !!e);
      const rest = entries.filter((e) => !recent.includes(e.href) && !e.hub).slice(0, 8 - Math.min(rec.length, 8));
      return [...rec.slice(0, 6), ...rest].slice(0, 9);
    }
    return entries
      .map((e) => ({ e, s: score(e, nq) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 12)
      .map((x) => x.e);
  }, [q, entries, recent]);

  useEffect(() => {
    if (open) {
      setQ("");
      setSel(0);
      setTimeout(() => input.current?.focus(), 10);
    }
  }, [open]);
  useEffect(() => setSel(0), [q]);
  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-i="${sel}"]`)?.scrollIntoView({ block: "nearest" });
  }, [sel]);

  if (!open) return null;
  const go = (e: Entry) => {
    onClose();
    if (e.raw) window.location.href = e.href;
    else router.push(e.href);
  };
  const onKey = (ev: React.KeyboardEvent) => {
    if (ev.key === "ArrowDown") { ev.preventDefault(); setSel((s) => Math.min(s + 1, results.length - 1)); }
    else if (ev.key === "ArrowUp") { ev.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
    else if (ev.key === "Enter" && results[sel]) { ev.preventDefault(); go(results[sel]); }
    else if (ev.key === "Escape") onClose();
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center px-3 pt-[12vh]" role="dialog" aria-modal="true" aria-label="Hızlı arama">
      <button className="absolute inset-0 bg-[#04182e]/60 backdrop-blur-sm" aria-label="Kapat" onClick={onClose} />
      <div className="relative w-full max-w-[600px] rounded-2xl bg-white shadow-2xl ring-1 ring-black/5 overflow-hidden">
        <div className="flex items-center gap-3 px-4 border-b border-line">
          <NavIcon name="search" className="w-5 h-5 text-muted" />
          <input
            ref={input}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKey}
            placeholder="Sayfa ya da işlem ara… (ör. iş kayıt, bordro, kargo)"
            className="flex-1 h-14 bg-transparent text-[16px] text-ink outline-none placeholder:text-muted"
            aria-controls="cp-list"
            aria-activedescendant={results[sel] ? `cp-${sel}` : undefined}
          />
          <kbd className="hidden sm:block text-[11px] text-muted border border-line rounded px-1.5 py-0.5">Esc</kbd>
        </div>
        <ul ref={list} id="cp-list" role="listbox" className="max-h-[52vh] overflow-y-auto p-2">
          {!q && recent.length > 0 && <li className="px-3 pt-1 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted">Son kullanılanlar ve öneriler</li>}
          {results.length === 0 && <li className="px-3 py-8 text-center text-muted">Sonuç yok</li>}
          {results.map((e, i) => (
            <li key={e.href} id={`cp-${i}`} data-i={i} role="option" aria-selected={i === sel}>
              <button
                onMouseEnter={() => setSel(i)}
                onClick={() => go(e)}
                className={`w-full flex items-center gap-3 rounded-xl px-3 py-2.5 text-left ${i === sel ? "bg-[#EAF2FB]" : ""}`}
              >
                <span className={`grid place-items-center w-9 h-9 rounded-lg ${i === sel ? "bg-brand-700 text-white" : "bg-ground text-brand-700"}`}>
                  <NavIcon name={recent.includes(e.href) && !q ? "clock" : e.slug} className="w-[18px] h-[18px]" />
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block font-semibold text-ink truncate">{e.label}</span>
                  <span className="block text-xs text-muted truncate">{e.group}{e.desc ? ` · ${e.desc}` : ""}</span>
                </span>
                {i === sel && <NavIcon name="arrow" className="w-4 h-4 text-brand-600" />}
              </button>
            </li>
          ))}
        </ul>
        <div className="hidden sm:flex gap-4 px-4 py-2 border-t border-line text-[11px] text-muted bg-ground">
          <span><kbd className="font-sans">↑ ↓</kbd> seç</span>
          <span><kbd className="font-sans">Enter</kbd> aç</span>
          <span><kbd className="font-sans">Ctrl / ⌘ + K</kbd> her yerden aç</span>
        </div>
      </div>
    </div>
  );
}
