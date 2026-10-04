"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Toast = { id: string; title: string; body: string | null; link: string | null };

/**
 * Akan ekran: yeni bildirim veya mesaj gelince sayfa yenilemeden rozetler ve listeler
 * tazelenir (gecikmeli, toplu yenileme); yeni bildirim ekranın köşesinde kısa süre görünür.
 */
export function LiveUpdates({ userId }: { userId: string }) {
  const router = useRouter();
  const path = usePathname();
  const pathRef = useRef(path);
  pathRef.current = path;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    const refresh = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => router.refresh(), 700);
    };
    const supabase = createClient();
    const ch = supabase
      .channel(`live:${userId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` }, (p) => {
        const n = p.new as Toast & { silent?: boolean };
        refresh();
        if (n.silent) return;
        // Açık sohbetin mesaj bildirimi gösterilmez
        if (n.link && n.link.startsWith("/mesajlar/") && pathRef.current === n.link) return;
        setToasts((t) => [...t.slice(-2), { id: n.id, title: n.title, body: n.body, link: n.link }]);
        setTimeout(() => setToasts((t) => t.filter((x) => x.id !== n.id)), 7000);
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, () => {
        // Mesajlar ekranı kendi listesini canlı günceller
        if (!pathRef.current.startsWith("/mesajlar")) refresh();
      })
      .subscribe();
    return () => {
      if (timer.current) clearTimeout(timer.current);
      supabase.removeChannel(ch);
    };
  }, [userId, router]);

  if (!toasts.length) return null;
  return (
    <div className="fixed z-50 right-3 left-3 md:left-auto md:w-[360px] bottom-[calc(84px+env(safe-area-inset-bottom))] md:bottom-4 flex flex-col gap-2 print:hidden" aria-live="polite">
      {toasts.map((t) => {
        const safe = t.link && t.link.startsWith("/") && !t.link.startsWith("//") ? t.link : null;
        const content = (
          <>
            <span className="font-semibold text-brand-800 block">{t.title}</span>
            {t.body && <span className="text-[13px] text-muted line-clamp-2">{t.body}</span>}
          </>
        );
        return (
          <div key={t.id} role="status" className="bg-white border border-line shadow-lg rounded-xl px-4 py-3 flex gap-3 items-start">
            <span className="mt-1 w-2.5 h-2.5 rounded-full bg-accent shrink-0" aria-hidden />
            {safe ? <Link href={safe} className="flex-1 min-w-0" onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))}>{content}</Link> : <div className="flex-1 min-w-0">{content}</div>}
            <button onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))} aria-label="Kapat" className="text-muted font-bold px-1">×</button>
          </div>
        );
      })}
    </div>
  );
}
