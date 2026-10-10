"use client";

import { useEffect } from "react";

/** Sitede iframe içinde açıldığında sayfa yüksekliğini üst pencereye bildirir (iframe kendini boyutlandırır) */
export function EmbedHeight() {
  useEffect(() => {
    if (window.parent === window) return;
    const send = () => window.parent.postMessage({ type: "mb-kariyer-height", height: document.documentElement.scrollHeight }, "*");
    send();
    const ro = new ResizeObserver(send);
    ro.observe(document.body);
    return () => ro.disconnect();
  }, []);
  return null;
}
