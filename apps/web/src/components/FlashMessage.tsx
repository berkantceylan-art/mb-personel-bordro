"use client";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

function Inner() {
  const sp = useSearchParams();
  const router = useRouter();
  const path = usePathname();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    const h = sp.get("hata");
    const t = sp.get("tamam");
    if (!h && !t) return;
    setMsg(h ? { ok: false, text: h } : { ok: true, text: t! });
    const rest = new URLSearchParams(sp.toString());
    rest.delete("hata");
    rest.delete("tamam");
    router.replace(path + (rest.size ? `?${rest}` : ""), { scroll: false });
    if (!h) setTimeout(() => setMsg(null), 5000);
  }, [sp, router, path]);
  if (!msg) return null;
  return (
    <div role={msg.ok ? "status" : "alert"} className={`fixed z-50 left-1/2 -translate-x-1/2 top-3 md:top-4 max-w-[min(92vw,640px)] rounded-xl shadow-lg px-4 py-3 flex gap-3 items-start text-sm ${msg.ok ? "bg-ok-bg text-ok border border-[#BFE3CC]" : "bg-bad-bg text-bad border border-[#F3C9C5]"}`}>
      <span className="flex-1">{msg.text}</span>
      <button onClick={() => setMsg(null)} aria-label="Kapat" className="font-bold px-1">×</button>
    </div>
  );
}

export function FlashMessage() {
  return (
    <Suspense fallback={null}>
      <Inner />
    </Suspense>
  );
}
