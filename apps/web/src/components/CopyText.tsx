"use client";
import { useState } from "react";

/** Metni panoya kopyalayan küçük düğme */
export function CopyText({ text, label = "Kopyala", className }: { text: string; label?: string; className?: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button type="button" onClick={async () => { try { await navigator.clipboard.writeText(text); setOk(true); setTimeout(() => setOk(false), 1500); } catch { /* izin yok */ } }}
      className={className ?? "h-9 px-3 rounded-[10px] border border-[#D5DEE8] text-sm font-semibold"}>{ok ? "Kopyalandı ✓" : label}</button>
  );
}
