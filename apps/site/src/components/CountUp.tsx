"use client";

import { useEffect, useRef, useState } from "react";

/** "25+", "1.200", "%98" gibi değerlerdeki sayıyı görününce sıfırdan sayar */
export function CountUp({ value }: { value: string }) {
  const m = /^(\D*)([\d.,]+)(.*)$/.exec(value);
  const target = m ? Number(m[2].replace(/[.,](?=\d{3}\b)/g, "").replace(",", ".")) : NaN;
  const [n, setN] = useState<number | null>(null);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!m || !Number.isFinite(target) || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const el = ref.current;
    if (!el) return;
    setN(0);
    const io = new IntersectionObserver(
      ([e]) => {
        if (!e.isIntersecting) return;
        io.disconnect();
        const t0 = performance.now();
        const dur = 1400;
        const tick = (t: number) => {
          const p = Math.min(1, (t - t0) / dur);
          setN(Math.round(target * (1 - Math.pow(1 - p, 3))));
          if (p < 1) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      },
      { threshold: 0.4 },
    );
    io.observe(el);
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  if (!m || n === null) return <span ref={ref}>{value}</span>;
  return (
    <span ref={ref} aria-label={value}>
      <span aria-hidden="true">
        {m[1]}
        {n.toLocaleString("tr-TR")}
        {m[3]}
      </span>
    </span>
  );
}
