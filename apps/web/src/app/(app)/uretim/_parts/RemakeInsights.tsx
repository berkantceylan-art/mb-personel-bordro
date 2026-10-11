"use client";
import { useActionState } from "react";
import { aiRemakeInsights } from "@/lib/ai-actions";

/** Yeniden yapım kayıtlarının yapay zekâ özeti */
export function RemakeInsights() {
  const [res, act, pending] = useActionState(aiRemakeInsights, null);
  return (
    <section className="rounded-[16px] border border-[#DDD6FE] bg-[#FAF8FF] p-4 flex flex-col gap-2">
      <form action={act} className="flex flex-wrap items-center gap-3">
        <b className="text-[#6D28D9]">✨ Yeniden yapım kök neden analizi</b>
        <span className="text-xs text-muted flex-1">Son 90 günün kayıtları yapay zekâyla özetlenir: en sık nedenler, yoğunlaştığı istasyon ve klinikler, önlem önerileri.</span>
        <button disabled={pending} className="h-9 px-4 rounded-[10px] bg-[#6D28D9] text-white text-sm font-semibold disabled:opacity-60">{pending ? "Analiz ediliyor…" : res ? "Yeniden analiz et" : "Analiz et"}</button>
      </form>
      {res && <div className={`whitespace-pre-wrap text-sm leading-relaxed ${res.ok ? "text-ink" : "text-bad font-semibold"}`}>{res.message}</div>}
    </section>
  );
}
