"use client";

import { useState } from "react";

/** Öncesi/sonrası karşılaştırma: tutamağı sürükle ya da klavye okları */
export function BeforeAfter({ before, after, alt, labels }: { before: string; after: string; alt: string; labels: { before: string; after: string; slider: string } }) {
  const [pos, setPos] = useState(50);
  return (
    <div className="relative aspect-[4/3] select-none overflow-hidden rounded-2xl bg-gypsum">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={after} alt={`${alt} — ${labels.after}`} className="absolute inset-0 h-full w-full object-cover" loading="lazy" draggable={false} />
      <div className="absolute inset-0 overflow-hidden" style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={before} alt={`${alt} — ${labels.before}`} className="absolute inset-0 h-full w-full object-cover" loading="lazy" draggable={false} />
      </div>
      <span className="pointer-events-none absolute left-3 top-3 rounded-full bg-ink/70 px-2.5 py-1 text-xs font-semibold text-white">{labels.before}</span>
      <span className="pointer-events-none absolute right-3 top-3 rounded-full bg-smile px-2.5 py-1 text-xs font-semibold text-navy">{labels.after}</span>
      <div className="pointer-events-none absolute inset-y-0 w-0.5 bg-white shadow-[0_0_0_1px_rgba(7,42,80,.2)]" style={{ left: `${pos}%` }}>
        <span className="absolute left-1/2 top-1/2 grid h-10 w-10 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-white text-navy shadow-lg">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="m9 6-6 6 6 6M15 6l6 6-6 6" />
          </svg>
        </span>
      </div>
      <input
        type="range"
        min={0}
        max={100}
        value={pos}
        onChange={(e) => setPos(Number(e.target.value))}
        aria-label={labels.slider}
        className="absolute inset-0 h-full w-full cursor-ew-resize opacity-0"
      />
    </div>
  );
}
