"use client";
import { useMemo, useRef, useState } from "react";
import Link from "next/link";

export type FisHit = { id: string; name: string; sub: string };
const norm = (s: string) => s.toLocaleLowerCase("tr-TR");

/** Fişli cari arama: 3 harf yazılınca eşleşen firmalar açılır; Enter / Ara ile tablo süzülür */
export function FisCariSearch({ items, q }: { items: FisHit[]; q: string }) {
  const [v, setV] = useState(q);
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(-1);
  const box = useRef<HTMLDivElement>(null);
  const hits = useMemo(() => {
    const n = norm(v.trim());
    if (n.length < 3) return [];
    const ws = n.split(/\s+/);
    return items
      .filter((p) => ws.every((w) => norm(`${p.name} ${p.sub}`).includes(w)))
      .sort((a, b) => Number(norm(b.name).startsWith(ws[0]!)) - Number(norm(a.name).startsWith(ws[0]!)) || a.name.localeCompare(b.name, "tr"))
      .slice(0, 12);
  }, [v, items]);
  const show = open && hits.length > 0;
  return (
    <form className="flex flex-wrap gap-2 items-center" onBlur={(e) => { if (!box.current?.contains(e.relatedTarget as Node)) setOpen(false); }}>
      <div ref={box} className="relative">
        <input name="q" value={v} autoComplete="off" placeholder="Firma ara (3 harf)" className="h-11 w-72 rounded-[10px] border border-[#D5DEE8] px-3 text-sm"
          onChange={(e) => { setV(e.target.value); setOpen(true); setHi(-1); }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (!show) return;
            if (e.key === "ArrowDown") { e.preventDefault(); setHi((h) => (h < 0 ? 0 : Math.min(h + 1, hits.length - 1))); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
            else if (e.key === "Escape") setOpen(false);
            else if (e.key === "Enter" && hi >= 0 && hits[hi]) { e.preventDefault(); window.location.href = `/finans/fis-cari/${hits[hi]!.id}`; }
          }} />
        {show && (
          <div role="listbox" className="absolute z-30 mt-1 w-[420px] max-w-[90vw] left-0 bg-white border border-[#D5DEE8] rounded-lg shadow-lg max-h-80 overflow-y-auto">
            {hits.map((p, i) => (
              <Link key={p.id} href={`/finans/fis-cari/${p.id}`} role="option" aria-selected={i === hi} onMouseEnter={() => setHi(i)}
                className={`block px-3 py-2 text-sm border-b border-[#EEF2F6] last:border-0 ${i === hi ? "bg-[#F3F8FD]" : ""}`}>
                <span className="font-semibold text-brand-700">{p.name}</span>
                <span className="block text-xs text-muted">{p.sub}</span>
              </Link>
            ))}
          </div>
        )}
      </div>
      <button className="h-11 rounded-[10px] bg-brand-700 px-4 font-semibold text-white text-sm">Ara</button>
      {q && <Link href="/finans/fis-cari" className="text-sm font-semibold text-muted">Temizle</Link>}
    </form>
  );
}
