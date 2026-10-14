"use client";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Onay beklerken sayfayı birkaç saniyede bir yeniler; onaylanınca QR kendiliğinden çıkar */
export function AutoReload({ seconds = 6 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => { const t = setInterval(() => router.refresh(), seconds * 1000); return () => clearInterval(t); }, [router, seconds]);
  return <span className="mt-2 inline-flex items-center gap-1.5 text-xs text-muted"><span className="h-2 w-2 animate-pulse rounded-full bg-[#F59E0B]" />Sayfa kendiliğinden yenileniyor</span>;
}
