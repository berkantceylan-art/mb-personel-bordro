"use client";
import Link from "next/link";
import { useEffect } from "react";

/** Beklenmeyen hata: genel Next.js sayfası yerine anlaşılır mesaj */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="p-4 md:p-8 max-w-xl">
      <div className="bg-white border border-[#F3C9C5] rounded-2xl p-6 flex flex-col gap-3">
        <h1 className="font-display text-lg font-bold text-bad">Bir şeyler ters gitti</h1>
        <p className="text-sm text-ink">İşlem tamamlanamadı. Sayfayı yenileyip tekrar deneyin; sorun sürerse hata kodunu bize iletin.</p>
        {error.digest && <p className="text-xs text-muted">Hata kodu: {error.digest}</p>}
        <div className="flex flex-wrap gap-2 pt-1">
          <button onClick={reset} className="h-11 px-4 rounded-[10px] bg-brand-700 text-white font-semibold">Tekrar dene</button>
          <Link href="/" className="h-11 px-4 inline-flex items-center rounded-[10px] border border-[#D5DEE8] bg-white text-brand-700 font-semibold">Ana sayfa</Link>
        </div>
      </div>
    </div>
  );
}
