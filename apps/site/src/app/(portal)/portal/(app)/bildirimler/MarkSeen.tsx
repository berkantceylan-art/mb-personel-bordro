"use client";
import { useEffect } from "react";

/** Bildirimler sayfası açılınca "görüldü" zamanını kaydeder (rozet sıfırlanır) */
export function MarkSeen() {
  useEffect(() => {
    document.cookie = `portal-bildirim=${encodeURIComponent(new Date().toISOString())}; path=/portal; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
  }, []);
  return null;
}
