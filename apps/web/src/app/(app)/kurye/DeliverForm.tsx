"use client";
import { useRef, useState } from "react";
import { SignaturePad, type SignaturePadHandle } from "@/components/SignaturePad";
import { deliverWaybill } from "@/lib/waybill-actions";

/** Teslim: teslim alanın adı ve imzası (telefonda parmakla) */
export function DeliverForm({ id }: { id: string }) {
  const [open, setOpen] = useState(false);
  const pad = useRef<SignaturePadHandle>(null);
  const [sig, setSig] = useState("");
  if (!open) return <button type="button" onClick={() => setOpen(true)} className="h-11 px-4 rounded-[12px] bg-ok text-white font-bold">Teslim et</button>;
  return (
    <form action={deliverWaybill} className="w-full flex flex-col gap-2 rounded-[12px] border border-line bg-[#F8FAFC] p-3">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="signature" value={sig} />
      <input name="to" required placeholder="Teslim alanın adı" className="h-11 rounded-[10px] border border-[#D5DEE8] bg-white px-3" />
      <SignaturePad ref={pad} onChange={setSig} />
      <input name="note" placeholder="Not (isteğe bağlı)" className="h-10 rounded-[10px] border border-[#D5DEE8] bg-white px-3 text-sm" />
      <div className="flex gap-2">
        <button className="h-11 flex-1 rounded-[12px] bg-ok text-white font-bold">Teslimi kaydet</button>
        <button type="button" onClick={() => { pad.current?.clear(); setSig(""); }} className="h-11 px-3 rounded-[12px] border border-line text-sm">İmzayı sil</button>
        <button type="button" onClick={() => setOpen(false)} className="h-11 px-3 rounded-[12px] border border-line text-sm">Vazgeç</button>
      </div>
    </form>
  );
}
