"use client";
import { useState } from "react";
import { useActionForm } from "@/lib/use-action-form";
import { visDecide } from "@/lib/visitor-actions";

/** Randevu talebi: saati düzenleyip onayla ya da nedenini yazıp reddet */
export function DecideForm({ id, at }: { id: string; at: string }) {
  const { state, pending, formProps } = useActionForm(visDecide);
  const [rej, setRej] = useState(false);
  if (state?.ok) {
    return (
      <div className="w-full text-sm rounded-lg px-3 py-2 bg-ok-bg text-ok flex flex-wrap items-center gap-2">
        <span className="flex-1">{state.message}</span>
        {state.wa && <a href={state.wa} target="_blank" rel="noreferrer" className="h-8 px-2 inline-flex items-center rounded-lg border border-[#25D366] bg-white text-xs font-semibold text-[#128C4B]">WhatsApp&apos;tan bildir</a>}
      </div>
    );
  }
  return (
    <form {...formProps} className="w-full flex flex-wrap items-center gap-2">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="ok" value={rej ? "0" : "1"} />
      {rej ? (
        <input name="reason" required minLength={2} maxLength={300} placeholder="Neden (ziyaretçiye gösterilir): ör. o gün izindeyim, başka gün önerin" aria-label="Ret nedeni" className="h-10 flex-1 min-w-[220px] rounded-[10px] border border-[#D5DEE8] px-3 text-sm" />
      ) : (
        <label className="flex items-center gap-2 text-sm">Saat <input type="datetime-local" name="at" defaultValue={at} className="h-10 rounded-[10px] border border-[#D5DEE8] px-2" /></label>
      )}
      <button disabled={pending} className={`h-10 px-4 rounded-[10px] text-white text-sm font-bold disabled:opacity-50 ${rej ? "bg-[#B42318]" : "bg-ok"}`}>{pending ? "…" : rej ? "Reddet" : "✓ Onayla"}</button>
      <button type="button" onClick={() => setRej((x) => !x)} className="h-10 px-3 rounded-[10px] border border-[#D5DEE8] text-sm font-semibold">{rej ? "← Vazgeç" : "Reddet"}</button>
      {state && !state.ok && <p role="status" className="w-full text-sm rounded-lg px-3 py-2 bg-bad-bg text-bad">{state.message}</p>}
    </form>
  );
}
