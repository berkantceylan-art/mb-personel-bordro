"use client";
import { useActionState } from "react";
import { postDeductions, savePayroll, type RunResult } from "./actions";

export function PayrollButtons({ period, canPost }: { period: string; canPost: boolean }) {
  const [s1, a1, p1] = useActionState<RunResult | null, FormData>(savePayroll, null);
  const [s2, a2, p2] = useActionState<RunResult | null, FormData>(postDeductions, null);
  const state = s2 ?? s1;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <form action={a1}>
          <input type="hidden" name="period" value={period} />
          <button disabled={p1} className="h-11 px-4 rounded-[10px] bg-brand-700 text-white font-semibold disabled:opacity-60">{p1 ? "Hesaplanıyor…" : "Bordroyu hesapla ve kaydet"}</button>
        </form>
        {canPost && (
          <form action={a2}>
            <input type="hidden" name="period" value={period} />
            <button disabled={p2} className="h-11 px-4 rounded-[10px] border border-[#D5DEE8] bg-white text-brand-700 font-semibold disabled:opacity-60">{p2 ? "Yazılıyor…" : "BES ve icra kesintilerini cariye yaz"}</button>
          </form>
        )}
      </div>
      {state && <p role="status" className={`text-sm rounded-lg px-3 py-2 ${state.ok ? "bg-ok-bg text-ok" : "bg-bad-bg text-bad"}`}>{state.message}</p>}
    </div>
  );
}
