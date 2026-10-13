"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

/** Sayfayı belirli aralıklarla sunucudan tazeler (canlı akış) */
export function AutoRefresh({ seconds = 30 }: { seconds?: number }) {
  const router = useRouter();
  const [on, setOn] = useState(true);
  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => { if (document.visibilityState === "visible") router.refresh(); }, seconds * 1000);
    return () => clearInterval(t);
  }, [on, seconds, router]);
  return (
    <button type="button" onClick={() => setOn(!on)} className="inline-flex items-center gap-1.5 text-xs font-semibold text-white/80">
      <span className={`w-2 h-2 rounded-full ${on ? "bg-[#34D399] animate-pulse" : "bg-white/40"}`} />{on ? `Canlı · ${seconds} sn` : "Duraklatıldı"}
    </button>
  );
}
