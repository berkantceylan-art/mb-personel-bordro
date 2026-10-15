"use client";
import { useState } from "react";

export type PnlPoint = { b: string; label: string; title: string; income: number; expense: number; net: number; today?: boolean };

const fmt = (k: number) => (k < 0 ? "−₺" : "₺") + new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 0 }).format(Math.abs(k) / 100);
const short = (k: number) => {
  const v = Math.abs(k) / 100;
  const s = v >= 1_000_000 ? `${(v / 1_000_000).toLocaleString("tr-TR", { maximumFractionDigits: 1 })} mn` : v >= 1000 ? `${Math.round(v / 1000).toLocaleString("tr-TR")} bin` : Math.round(v).toLocaleString("tr-TR");
  return (k < 0 ? "−" : "") + s;
};

/** Gelir / gider çubukları + net kâr çizgisi (tek eksen, TL). Üzerine gelince dönem ayrıntısı. */
export function PnlChart({ data }: { data: PnlPoint[] }) {
  const [hi, setHi] = useState<number | null>(null);
  const W = 760, H = 240, padL = 52, padB = 26, padT = 12;
  const n = Math.max(1, data.length);
  const vals = data.flatMap((d) => [d.income, d.expense, d.net, 0]);
  const rawMax = Math.max(1, ...vals), rawMin = Math.min(0, ...vals);
  // yuvarlak eksen adımı (1, 2, 2.5, 5 × 10^n)
  const raw = (rawMax - rawMin) / 4;
  const mag = 10 ** Math.floor(Math.log10(raw || 1));
  const step = ([1, 2, 2.5, 5, 10].find((m) => m * mag >= raw) ?? 10) * mag;
  const max = Math.ceil(rawMax / step) * step, min = Math.floor(rawMin / step) * step;
  const span = max - min || 1;
  const Y = (v: number) => padT + ((max - v) / span) * (H - padT - padB);
  const bw = (W - padL - 8) / n;
  const bar = Math.max(2, Math.min(18, (bw - 6) / 2));
  const x0 = (i: number) => padL + i * bw + (bw - (bar * 2 + 2)) / 2;
  const cx = (i: number) => padL + i * bw + bw / 2;
  const ticks: number[] = [];
  for (let t = min; t <= max + step / 2; t += step) ticks.push(t);
  const labelEvery = Math.ceil(n / 12);
  const rr = (x: number, w: number, y1: number, y2: number) => {
    const top = Math.min(y1, y2), h = Math.abs(y2 - y1);
    if (h < 0.5) return "";
    const r = Math.min(4, w / 2, h);
    return `M${x},${top + h} V${top + r} q0,-${r} ${r},-${r} h${w - 2 * r} q${r},0 ${r},${r} V${top + h} Z`;
  };
  const line = data.map((d, i) => `${i ? "L" : "M"}${cx(i).toFixed(1)},${Y(d.net).toFixed(1)}`).join(" ");
  const h = hi != null ? data[hi] : null;

  return (
    <div className="relative">
      <div className="flex flex-wrap items-center gap-4 text-xs text-[#52514e] mb-2" aria-hidden>
        <span className="flex items-center gap-1.5"><i className="w-3 h-3 rounded-[3px] bg-[#2a78d6]" />Gelir</span>
        <span className="flex items-center gap-1.5"><i className="w-3 h-3 rounded-[3px] bg-[#eb6834]" />Gider (personel dahil)</span>
        <span className="flex items-center gap-1.5"><i className="w-4 h-[2px] bg-[#0B1F3A]" />Net kâr</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto select-none" role="img" aria-label="Gelir, gider ve net kâr grafiği" onMouseLeave={() => setHi(null)}>
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={padL} x2={W} y1={Y(t)} y2={Y(t)} stroke={Math.abs(t) < span / 1e6 ? "#B8C4D1" : "#EDF1F5"} strokeWidth={1} />
            <text x={padL - 8} y={Y(t) + 4} textAnchor="end" fontSize={10.5} fill="#6B7785">{short(t)}</text>
          </g>
        ))}
        <line x1={padL} x2={W} y1={Y(0)} y2={Y(0)} stroke="#9AA8B6" strokeWidth={1} />
        {data.map((d, i) => (
          <g key={d.b}>
            {hi === i && <rect x={padL + i * bw} y={padT} width={bw} height={H - padT - padB} fill="#EEF4FB" rx={6} />}
            <path d={rr(x0(i), bar, Y(0), Y(d.income))} fill="#2a78d6" opacity={hi == null || hi === i ? 1 : 0.45} />
            <path d={rr(x0(i) + bar + 2, bar, Y(0), Y(d.expense))} fill="#eb6834" opacity={hi == null || hi === i ? 1 : 0.45} />
            {(i % labelEvery === 0 || i === n - 1) && <text x={cx(i)} y={H - 8} textAnchor="middle" fontSize={10.5} fill={d.today ? "#0B1F3A" : "#6B7785"} fontWeight={d.today ? 700 : 400}>{d.label}</text>}
          </g>
        ))}
        <path d={line} fill="none" stroke="#0B1F3A" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {data.map((d, i) => (n <= 40 || hi === i) && <circle key={d.b} cx={cx(i)} cy={Y(d.net)} r={hi === i ? 5 : 3.5} fill={d.net < 0 ? "#D64545" : "#0B1F3A"} stroke="#fff" strokeWidth={2} />)}
        {data.map((d, i) => <rect key={d.b} x={padL + i * bw} y={0} width={bw} height={H} fill="transparent" onMouseEnter={() => setHi(i)} onClick={() => setHi(i)} />)}
      </svg>
      {h && (
        <div className="pointer-events-none absolute top-8 z-10 rounded-xl bg-[#0B1F3A] text-white text-xs px-3 py-2 shadow-xl min-w-[170px]"
          style={{ left: `clamp(0px, calc(${((cx(hi!) / W) * 100).toFixed(1)}% - 85px), calc(100% - 180px))` }}>
          <div className="font-semibold mb-1">{h.title}</div>
          <div className="flex justify-between gap-4"><span className="opacity-80">Gelir</span><span className="tabular-nums">{fmt(h.income)}</span></div>
          <div className="flex justify-between gap-4"><span className="opacity-80">Gider</span><span className="tabular-nums">{fmt(h.expense)}</span></div>
          <div className="flex justify-between gap-4 border-t border-white/20 mt-1 pt-1 font-semibold"><span>Net</span><span className={`tabular-nums ${h.net < 0 ? "text-[#FF9C9C]" : "text-[#8FE3B8]"}`}>{fmt(h.net)}</span></div>
        </div>
      )}
    </div>
  );
}
