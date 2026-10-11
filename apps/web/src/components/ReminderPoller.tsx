"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { pollReminders } from "@/lib/desktop-actions";

type Hit = { id: string; title: string; body: string; link: string };

/** Uygulama açıkken her dakika hatırlatmaları denetler; zamanı gelende ekranda uyarı ve tarayıcı bildirimi gösterir */
export function ReminderPoller() {
  const [hits, setHits] = useState<Hit[]>([]);
  useEffect(() => {
    let stop = false;
    const seen = new Set<string>();
    const tick = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const r = await pollReminders();
        const fresh = r.filter((h) => !seen.has(h.id));
        fresh.forEach((h) => seen.add(h.id));
        if (!stop && fresh.length) {
          setHits((x) => [...fresh, ...x].slice(0, 4));
          if ("Notification" in window && Notification.permission === "granted") {
            fresh.forEach((h) => { try { new Notification(h.title, { body: h.body, icon: "/icon-192.png" }); } catch { /* yok say */ } });
          }
        }
      } catch { /* çevrimdışı */ }
    };
    const first = setTimeout(tick, 4000);
    const t = setInterval(tick, 60000);
    return () => { stop = true; clearTimeout(first); clearInterval(t); };
  }, []);
  if (!hits.length) return null;
  return (
    <div className="fixed bottom-4 right-4 z-[60] flex w-[min(92vw,360px)] flex-col gap-2 print:hidden" role="status" aria-live="polite">
      {hits.map((h) => (
        <div key={h.id} className="rounded-2xl border border-[#F5D9A8] bg-[#FFF8EB] p-4 shadow-xl">
          <div className="flex items-start gap-2">
            <b className="flex-1 text-ink">{h.title}</b>
            <button type="button" onClick={() => setHits((x) => x.filter((y) => y.id !== h.id))} aria-label="Kapat" className="text-muted hover:text-ink">✕</button>
          </div>
          {h.body && <p className="mt-1 text-sm text-ink">{h.body}</p>}
          {h.link && h.link !== "/" && <Link href={h.link} onClick={() => setHits((x) => x.filter((y) => y.id !== h.id))} className="mt-2 inline-block text-sm font-semibold text-brand-700">Aç →</Link>}
        </div>
      ))}
    </div>
  );
}
