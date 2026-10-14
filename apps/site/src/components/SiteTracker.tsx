"use client";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";

const send = (body: Record<string, unknown>, beacon = false) => {
  const json = JSON.stringify(body);
  try {
    if (beacon && navigator.sendBeacon) { navigator.sendBeacon("/api/t", new Blob([json], { type: "text/plain" })); return Promise.resolve(null); }
    return fetch("/api/t", { method: "POST", body: json, keepalive: true, headers: { "content-type": "text/plain" } }).then((r) => r.json()).catch(() => null);
  } catch { return Promise.resolve(null); }
};
const session = () => {
  try {
    let s = sessionStorage.getItem("mb_s");
    if (!s) { s = Math.random().toString(36).slice(2, 14); sessionStorage.setItem("mb_s", s); }
    return s;
  } catch { return null; }
};

/** Çerezsiz site istatistiği: sayfa görüntüleme, sayfada kalma süresi, WhatsApp / telefon / e-posta tıklamaları */
export function SiteTracker() {
  const pathname = usePathname();
  const sp = useSearchParams();
  const cur = useRef<{ id: number | null; t: number } | null>(null);
  const first = useRef(true);

  useEffect(() => {
    const leave = () => { if (cur.current?.id) send({ t: "ms", id: cur.current.id, ms: Date.now() - cur.current.t }, true); };
    leave();
    const ref = first.current ? document.referrer : "";
    first.current = false;
    const rec = { id: null as number | null, t: Date.now() };
    cur.current = rec;
    void send({ t: "view", path: pathname, ref, session: session(), utm_source: sp.get("utm_source") ?? sp.get("ref") ?? undefined, utm_campaign: sp.get("utm_campaign") ?? undefined })
      .then((r: { id?: number } | null) => { rec.id = r?.id ?? null; });
    const onHide = () => { if (document.visibilityState === "hidden") leave(); };
    document.addEventListener("visibilitychange", onHide);
    return () => document.removeEventListener("visibilitychange", onHide);
  }, [pathname, sp]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const a = (e.target as HTMLElement | null)?.closest?.("a,[data-track]") as HTMLElement | null;
      if (!a) return;
      const href = a.getAttribute("href") ?? "";
      const name = a.dataset.track ?? (href.startsWith("tel:") ? "phone" : /wa\.me|whatsapp/i.test(href) ? "whatsapp" : href.startsWith("mailto:") ? "email" : /\.(pdf|zip|stl)$/i.test(href) ? "download" : /instagram|facebook|linkedin|youtube/i.test(href) ? "social" : null);
      if (name) void send({ t: "event", name, path: location.pathname, session: session() });
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);
  return null;
}
