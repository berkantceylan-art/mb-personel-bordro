"use client";
import { useMemo, useRef, useState } from "react";
import Link from "next/link";

export type CariHit = { id: string; name: string; tax_no: string | null; phone: string | null; city: string | null; code: string | null; kind: string; active: boolean };

const norm = (s: string) => s.toLocaleLowerCase("tr-TR");

/** Cari arama: 3 harf yazılınca eşleşen cariler açılır; Enter / Ara ile liste filtrelenir */
export function CariSearch({ items, tur, q, pasif, g, inputCls, btnCls }: { items: CariHit[]; tur: string; q: string; pasif: boolean; g?: string; inputCls: string; btnCls: string }) {
  const [v, setV] = useState(q);
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(-1);
  const box = useRef<HTMLDivElement>(null);
  const hits = useMemo(() => {
    const n = norm(v.trim());
    if (n.length < 3) return [];
    const ws = n.split(/\s+/);
    return items
      .filter((p) => (pasif || p.active) && ws.every((w) => norm(`${p.name} ${p.tax_no ?? ""} ${p.phone ?? ""} ${p.city ?? ""} ${p.code ?? ""}`).includes(w)))
      .sort((a, b) => Number(norm(b.name).startsWith(ws[0]!)) - Number(norm(a.name).startsWith(ws[0]!)) || a.name.localeCompare(b.name, "tr"))
      .slice(0, 12);
  }, [v, items, pasif]);
  const show = open && hits.length > 0;
  return (
    <form className="flex gap-2" onBlur={(e) => { if (!box.current?.contains(e.relatedTarget as Node)) setOpen(false); }}>
      {tur && <input type="hidden" name="tur" value={tur} />}
      {g && <input type="hidden" name="g" value={g} />}
      <div ref={box} className="relative">
        <input name="q" value={v} autoComplete="off" placeholder="Ad, VKN, telefon, şehir (3 harf)" className={`${inputCls} w-72`}
          onChange={(e) => { setV(e.target.value); setOpen(true); setHi(-1); }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (!show) return;
            // ok tuşlarıyla seçilen cari Enter ile açılır; seçim yapılmadıysa Enter listeyi filtreler
            if (e.key === "ArrowDown") { e.preventDefault(); setHi((h) => (h < 0 ? 0 : Math.min(h + 1, hits.length - 1))); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
            else if (e.key === "Escape") setOpen(false);
            else if (e.key === "Enter" && hi >= 0 && hits[hi]) { e.preventDefault(); window.location.href = `/finans/cariler/${hits[hi]!.id}`; }
          }} />
        {show && (
          <div role="listbox" className="absolute z-30 mt-1 w-[420px] max-w-[90vw] right-0 bg-white border border-[#D5DEE8] rounded-lg shadow-lg max-h-80 overflow-y-auto">
            {hits.map((p, i) => (
              <Link key={p.id} href={`/finans/cariler/${p.id}`} role="option" aria-selected={i === hi} onMouseEnter={() => setHi(i)}
                className={`block px-3 py-2 text-sm border-b border-[#EEF2F6] last:border-0 ${i === hi ? "bg-[#F3F8FD]" : ""}`}>
                <span className="font-semibold text-brand-700">{p.name}</span>{!p.active && <span className="ml-1.5 text-xs text-muted">(pasif)</span>}
                <span className="block text-xs text-muted">{[p.kind, p.tax_no && `VKN ${p.tax_no}`, p.city, p.phone].filter(Boolean).join(" · ")}</span>
              </Link>
            ))}
          </div>
        )}
      </div>
      <button className={btnCls}>Ara</button>
    </form>
  );
}
