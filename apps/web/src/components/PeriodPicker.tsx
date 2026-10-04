"use client";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";

const MONTHS = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
const label = (p: string) => `${MONTHS[Number(p.slice(5, 7)) - 1]} ${p.slice(0, 4)}`;
const shift = (p: string, d: number) => {
  const dt = new Date(Date.UTC(Number(p.slice(0, 4)), Number(p.slice(5, 7)) - 1 + d, 1));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}`;
};

/** Dönem seçici: ← açılır liste → ; seçim ?donem= ile adrese yazılır */
export function PeriodPicker({ value, options }: { value: string; options: string[] }) {
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();
  const [pending, start] = useTransition();
  const href = (p: string) => {
    const q = new URLSearchParams(sp.toString());
    q.set("donem", p);
    return `${path}?${q}`;
  };
  const all = [...new Set([...options, value])].sort().reverse();
  const btn = "h-11 w-11 inline-flex items-center justify-center rounded-[10px] border border-[#D5DEE8] bg-white font-semibold text-brand-700";
  return (
    <div className={`flex items-center gap-1.5 ${pending ? "opacity-60" : ""}`}>
      <Link href={href(shift(value, -1))} className={btn} aria-label="Önceki dönem">←</Link>
      <select
        value={value}
        onChange={(e) => start(() => router.push(href(e.target.value)))}
        aria-label="Dönem seç"
        className="h-11 rounded-[10px] border border-[#D5DEE8] bg-white px-3 font-semibold text-brand-800"
      >
        {all.map((p) => <option key={p} value={p}>{label(p)}</option>)}
      </select>
      <Link href={href(shift(value, 1))} className={btn} aria-label="Sonraki dönem">→</Link>
    </div>
  );
}
