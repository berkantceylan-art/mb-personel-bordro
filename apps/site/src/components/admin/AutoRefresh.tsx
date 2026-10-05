"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Sayfayı belirli aralıklarla sunucudan yeniler (sekme görünürken) */
export function AutoRefresh({ seconds }: { seconds: number }) {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => {
      if (!document.hidden) router.refresh();
    }, seconds * 1000);
    return () => clearInterval(id);
  }, [router, seconds]);
  return null;
}
