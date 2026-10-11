"use client";
import { useEffect, useState } from "react";

/** Büyük saat ve tarih (atölye ekranı) */
export function Clock() {
  const [t, setT] = useState<Date | null>(null);
  useEffect(() => {
    setT(new Date());
    const i = setInterval(() => setT(new Date()), 1000);
    return () => clearInterval(i);
  }, []);
  if (!t) return <span className="font-display text-4xl font-bold tabular-nums">--:--</span>;
  return (
    <span className="text-right">
      <span className="block font-display text-4xl font-bold tabular-nums leading-none">{t.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Istanbul" })}</span>
      <span className="text-sm text-white/60">{t.toLocaleDateString("tr-TR", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/Istanbul" })}</span>
    </span>
  );
}
