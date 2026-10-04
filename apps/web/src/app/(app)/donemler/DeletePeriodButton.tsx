"use client";
import { useState } from "react";
import { useFormStatus } from "react-dom";
import { deletePeriod } from "./actions";

function Submit() {
  const { pending } = useFormStatus();
  return <button disabled={pending} className="h-9 px-3 rounded-lg bg-bad text-white text-[13px] font-semibold disabled:opacity-60">{pending ? "Siliniyor…" : "Kalıcı olarak sil"}</button>;
}

/** Dönemi komple silme: yanlışlıkla basılmasın diye "SİL" yazılması istenir */
export function DeletePeriodButton({ period, label }: { period: string; label: string }) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return <button type="button" onClick={() => setOpen(true)} className="h-9 px-3 rounded-lg border border-[#F3C9C5] bg-white text-[13px] font-semibold text-bad">Sil</button>;
  }
  return (
    <form action={deletePeriod} className="flex flex-wrap items-center gap-2 text-xs">
      <input type="hidden" name="period" value={period} />
      <span className="text-ink max-w-[260px]">{label} dönemindeki tüm hareketler, bordro ve fazla mesai kayıtları silinecek. Onay için <b>SİL</b> yazın:</span>
      <input name="confirm" autoFocus autoComplete="off" aria-label="Onay" className="h-9 w-20 rounded-lg border border-[#D5DEE8] px-2 uppercase" />
      <Submit />
      <button type="button" onClick={() => setOpen(false)} className="h-9 px-3 rounded-lg border border-[#D5DEE8] font-semibold text-muted">Vazgeç</button>
    </form>
  );
}
