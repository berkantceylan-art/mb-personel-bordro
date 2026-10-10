"use client";

import { useEffect, useRef, useState } from "react";

/** ERP'nin başvuru formunu sitenin içinde gösterir; yüksekliği formdan gelen mesajla ayarlanır */
export function ApplyFrame({ src, origin, title }: { src: string; origin: string; title: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(1200);
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.origin !== origin || e.source !== ref.current?.contentWindow) return;
      const d = e.data as { type?: string; height?: number };
      if (d?.type === "mb-kariyer-height" && typeof d.height === "number" && d.height > 200) setHeight(Math.min(d.height + 8, 6000));
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [origin]);
  return <iframe ref={ref} src={src} title={title} style={{ height }} className="w-full rounded-3xl border-0 bg-transparent" loading="lazy" />;
}
