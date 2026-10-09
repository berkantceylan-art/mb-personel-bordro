"use client";
import { useState } from "react";
import { PendingSubmit } from "@/components/ConfirmSubmit";

const today = () => new Date().toISOString().slice(0, 10);

/** "Ofise çağır": tarih, saat ve neden sorar; personele bildirim gider */
export function OfficeCallButton({ employeeId, action }: { employeeId: string; action: (f: FormData) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const input = "h-11 rounded-[10px] border border-[#D5DEE8] px-3 bg-white";
  return (
    <>
      <button type="button" onClick={() => setOpen((v) => !v)} className="h-11 px-4 inline-flex items-center rounded-[10px] border border-[#D5DEE8] bg-white font-semibold text-brand-700" aria-expanded={open}>
        📍 Ofise çağır
      </button>
      {open && (
        <form action={action} className="w-full flex flex-wrap gap-2 items-end rounded-xl border border-[#D5DEE8] bg-[#F7F9FB] p-3">
          <input type="hidden" name="employeeId" value={employeeId} />
          <label className="flex flex-col gap-1 text-xs text-muted">Gün<input type="date" name="on_date" required defaultValue={today()} className={input} /></label>
          <label className="flex flex-col gap-1 text-xs text-muted">Saat<input type="time" name="at_time" className={input} /></label>
          <label className="flex flex-col gap-1 text-xs text-muted flex-1 min-w-48">Neden (personel görür)<input name="reason" placeholder="ör. belge imzası, görüşme" className={`${input} w-full`} /></label>
          <PendingSubmit className="h-11 px-4 rounded-[10px] bg-brand-700 text-white font-semibold">Çağrı gönder</PendingSubmit>
          <button type="button" onClick={() => setOpen(false)} className="h-11 px-3 text-sm font-semibold text-muted">Vazgeç</button>
        </form>
      )}
    </>
  );
}
