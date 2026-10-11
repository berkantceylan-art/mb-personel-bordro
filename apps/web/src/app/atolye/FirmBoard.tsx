"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

export type Firm = { id: string; name: string; since: string; total: number; out_n: number; open_n: number; out_today: number; late: number; open_units: number; next_due: string | null; pending: { no: number; stage: string; due: string | null }[] };

const STAGE: Record<string, [string, string]> = {
  reception: ["Kayıt", "#64748B"], production: ["Üretim", "#2563EB"], chief: ["Şef", "#7C3AED"], qc: ["Kontrol", "#0891B2"],
  dispatch: ["Çıkış", "#059669"], tryin: ["Prova", "#D97706"],
};
const CARD_W = 300; // kart en az genişliği (px)
const CARD_H = 76; // kart yüksekliği (px)
const GAP = 6;
const PAGE_SECONDS = 12;
/** Kartta tek satıra sığan kadar iş: 3'ten fazlaysa 2 iş + "+n" (geniş kartta 4 / 3) */
const chips = (f: { open_n: number; pending: { no: number; stage: string; due: string | null }[] }) => (f.open_n > 3 ? f.pending.slice(0, 2) : f.pending.slice(0, 3));
const dm = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("tr-TR", { day: "2-digit", month: "2-digit" });

/**
 * TV için firma panosu: kalan işi olan firmalar ekrana sığdığı kadar kart hâlinde, sığmayanlar sayfalara bölünür
 * ve 12 sn'de bir sayfa döner. Bugün işi tamamen bitenler altta tek satırda.
 */
export function FirmBoard({ firms, today }: { firms: Firm[]; today: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [perPage, setPerPage] = useState(24);
  const [page, setPage] = useState(0);
  const active = firms.filter((f) => f.open_n > 0);
  const done = firms.filter((f) => f.open_n === 0);
  const pages = Math.max(1, Math.ceil(active.length / perPage));

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const fit = () => {
      const cols = Math.max(1, Math.floor((el.clientWidth + GAP) / (CARD_W + GAP)));
      const rows = Math.max(1, Math.floor((el.clientHeight + GAP) / (CARD_H + GAP)));
      setPerPage(cols * rows);
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    if (pages <= 1) return;
    const t = setInterval(() => setPage((p) => (p + 1) % pages), PAGE_SECONDS * 1000);
    return () => clearInterval(t);
  }, [pages]);
  const cur = page % pages;
  const shown = active.slice(cur * perPage, cur * perPage + perPage);
  const totalLeft = active.reduce((a, f) => a + f.open_n, 0);

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-baseline gap-3 mb-2">
        <h2 className="font-display text-lg font-bold">Firmalar</h2>
        <span className="text-sm text-white/50">{active.length} firmada <b className="text-[#FBBF24]">{totalLeft}</b> iş kaldı</span>
        <span className="hidden lg:flex items-center gap-2.5 text-xs text-white/60 ml-4">
          {Object.entries(STAGE).map(([k, [l, c]]) => <span key={k} className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm" style={{ background: c }} />{l}</span>)}
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm ring-2 ring-[#F87171]" />gecikmiş</span>
        </span>
        {pages > 1 && (
          <span className="ml-auto flex items-center gap-1.5 text-xs text-white/50">
            sayfa {cur + 1}/{pages}
            {Array.from({ length: pages }, (_, i) => <span key={i} className={`w-2 h-2 rounded-full ${i === cur ? "bg-white" : "bg-white/20"}`} />)}
          </span>
        )}
      </div>
      <div ref={box} className="flex-1 min-h-0 overflow-hidden">
        <div className="grid content-start" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${CARD_W}px, 1fr))`, gap: GAP }}>
          {shown.map((f) => {
            const pct = f.total ? (f.out_n / f.total) * 100 : 0;
            const lateDue = f.next_due && f.next_due < today;
            return (
              <div key={f.id} style={{ height: CARD_H }} className={`relative rounded-xl px-3 pt-2 pb-2.5 flex flex-col justify-between overflow-hidden border ${f.late ? "bg-[#7F1D1D]/40 border-[#F87171]/40" : "bg-white/[.06] border-white/10"}`}>
                <div className="flex items-baseline gap-2 min-w-0">
                  <b className="truncate flex-1 text-[15px] leading-tight">{f.name}</b>
                  <span className={`font-display text-2xl font-black tabular-nums leading-none ${f.late ? "text-[#F87171]" : "text-[#FBBF24]"}`}>{f.open_n}</span>
                  <span className="text-xs text-white/60">kaldı</span>
                </div>
                <div className="flex items-center gap-1 min-w-0">
                  {chips(f).map((p) => (
                    <span key={p.no} title={STAGE[p.stage]?.[0]} style={{ background: STAGE[p.stage]?.[1] ?? "#64748B" }}
                      className={`rounded-md px-2 py-0.5 text-[15px] font-bold tabular-nums leading-snug text-white ${p.due && p.due < today ? "ring-2 ring-[#F87171]" : ""}`}>
                      #{p.no}
                    </span>
                  ))}
                  {f.open_n > chips(f).length && <span className="rounded-md px-2 py-0.5 text-[15px] font-bold leading-snug bg-white/10 text-white/80">+{f.open_n - chips(f).length}</span>}
                  <span className="ml-auto pl-1 text-[11px] tabular-nums text-white/60 whitespace-nowrap text-right leading-tight">{f.out_n}/{f.total} çıktı{f.next_due ? <><br /><span className={lateDue ? "text-[#FCA5A5]" : f.next_due === today ? "text-[#FDE68A]" : ""}>teslim {dm(f.next_due)}</span></> : null}</span>
                </div>
                <div className="absolute inset-x-0 bottom-0 h-1 bg-white/10"><div className="h-full bg-[#34D399]" style={{ width: `${pct}%` }} /></div>
              </div>
            );
          })}
        </div>
        {active.length === 0 && <p className="text-white/50">İçeride bekleyen iş yok.</p>}
      </div>
      {done.length > 0 && (
        <div className="mt-2 text-sm text-white/70 truncate">
          <span className="text-[#34D399] font-semibold">✓ Bugün işi biten ({done.length}):</span> {done.map((f) => `${f.name} (${f.out_n})`).join(" · ")}
        </div>
      )}
    </div>
  );
}
