"use client";

import { useState } from "react";

export function CopyButton({ text, label = "Adresi kopyala" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1800);
        } catch {
          /* pano izni yoksa sessiz geç */
        }
      }}
      className="rounded-full border border-gypsum bg-white px-4 py-2 text-sm font-semibold text-navy hover:border-navy"
    >
      {done ? "Kopyalandı ✓" : label}
    </button>
  );
}
