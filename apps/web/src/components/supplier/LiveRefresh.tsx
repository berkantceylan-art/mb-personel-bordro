"use client";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Sayfayı belirli aralıkla tazeler (yazışma canlı görünsün); yazışmayı en alta kaydırır */
export function LiveRefresh({ seconds = 20 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const el = document.getElementById("thread");
    if (el) el.scrollTop = el.scrollHeight;
    const t = setInterval(() => {
      const typing = document.activeElement instanceof HTMLTextAreaElement && document.activeElement.value.length > 0;
      if (!document.hidden && !typing) router.refresh();
    }, seconds * 1000);
    return () => clearInterval(t);
  }, [router, seconds]);
  return null;
}
