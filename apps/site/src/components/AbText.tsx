"use client";
import { useEffect, useState } from "react";

type Test = { key: string; a: string; b: string; active: boolean; winner: "A" | "B" | null };
const send = (name: string) => {
  try { navigator.sendBeacon?.("/api/t", new Blob([JSON.stringify({ t: "event", name, path: location.pathname })], { type: "text/plain" })); } catch { /* yok */ }
};

/** A/B testi: ziyaretçiye A ya da B metni (oturum boyunca aynı), görüntülenme ve tıklama sayılır */
export function AbText({ test, fallback }: { test: Test | null; fallback: string }) {
  const [v, setV] = useState<"A" | "B" | null>(null);
  useEffect(() => {
    if (!test || !test.active || test.winner) return;
    let pick: "A" | "B";
    try {
      const k = `ab_${test.key}`;
      pick = (sessionStorage.getItem(k) as "A" | "B" | null) ?? (Math.random() < 0.5 ? "A" : "B");
      sessionStorage.setItem(k, pick);
      if (!sessionStorage.getItem(`${k}_v`)) { sessionStorage.setItem(`${k}_v`, "1"); send(`ab:${test.key}:${pick}:view`); }
    } catch { pick = "A"; }
    setV(pick);
  }, [test]);
  if (!test) return <>{fallback}</>;
  if (test.winner) return <>{(test.winner === "B" ? test.b : test.a) || fallback}</>;
  if (!test.active) return <>{test.a || fallback}</>;
  const text = v === "B" ? test.b : v === "A" ? test.a : fallback;
  return <span onClickCapture={() => v && send(`ab:${test.key}:${v}:click`)}>{text || fallback}</span>;
}
