"use client";
import { useEffect } from "react";

/** Bulunamayan sayfa adresini istatistiğe yazar (SEO denetiminde kırık bağlantı listesi) */
export function NotFoundTracker() {
  useEffect(() => {
    try { navigator.sendBeacon?.("/api/t", new Blob([JSON.stringify({ t: "event", name: "404", path: location.pathname, ref: document.referrer })], { type: "text/plain" })); } catch { /* yok */ }
  }, []);
  return null;
}
