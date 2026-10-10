"use client";
import Link from "next/link";
import { useEffect, useState } from "react";

/** Yalnız zorunlu çerez kullanıldığını bildiren küçük şerit (bir kez kapatılınca görünmez) */
export function CookieNotice({ text, more, ok, href }: { text: string; more: string; ok: string; href: string }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    try {
      setShow(localStorage.getItem("cerez-bildirim") !== "1");
    } catch {
      setShow(false);
    }
  }, []);
  if (!show) return null;
  return (
    <div role="region" aria-label={more} className="fixed inset-x-3 bottom-3 z-40 mx-auto flex max-w-xl flex-wrap items-center gap-3 rounded-2xl bg-ink/95 px-4 py-3 text-sm text-white shadow-lg sm:bottom-5 print:hidden">
      <p className="flex-1 min-w-48">{text} <Link href={href} className="underline">{more}</Link></p>
      <button
        type="button"
        onClick={() => {
          try {
            localStorage.setItem("cerez-bildirim", "1");
          } catch {}
          setShow(false);
        }}
        className="rounded-full bg-smile px-4 py-1.5 font-semibold text-navy"
      >
        {ok}
      </button>
    </div>
  );
}
