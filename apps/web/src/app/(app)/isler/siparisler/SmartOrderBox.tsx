"use client";
import { useActionState, useState } from "react";
import { aiOrderFromText } from "@/lib/ai-actions";

/** Yapay zekâ ile sipariş: WhatsApp / e-posta mesajını yapıştır → taslak sipariş */
export function SmartOrderBox() {
  const [open, setOpen] = useState(false);
  const [res, act, pending] = useActionState(aiOrderFromText, null);
  if (!open) return <button type="button" onClick={() => setOpen(true)} className="self-start h-10 px-4 rounded-full border border-[#C4B5FD] bg-[#F5F3FF] text-sm font-semibold text-[#6D28D9]">✨ Mesajdan sipariş oluştur (yapay zekâ)</button>;
  return (
    <form action={act} className="rounded-[18px] border border-[#DDD6FE] bg-[#FAF8FF] p-4 flex flex-col gap-3">
      <div className="flex items-center gap-2"><b className="text-[#6D28D9]">✨ Mesajdan sipariş</b><span className="text-xs text-muted">WhatsApp ya da e-postadaki sipariş metnini yapıştırın; müşteri, hasta, iş, diş, renk ve tarih okunur, siparişe dönüşür. Kaydetmeden önce kontrol edin.</span></div>
      <textarea name="text" rows={4} required placeholder="ör. Merhaba, Ayşe Yılmaz için 11-21 zirkon kron 2 adet, renk A2, cuma lazım. Dr. Mehmet / Smile Klinik" className="rounded-[12px] border border-[#D5DEE8] bg-white px-3 py-2 text-sm" />
      <div className="flex flex-wrap items-center gap-2">
        <select name="source" defaultValue="whatsapp" className="h-10 rounded-[10px] border border-[#D5DEE8] bg-white px-2 text-sm"><option value="whatsapp">WhatsApp</option><option value="email">E-posta</option><option value="phone">Telefon notu</option></select>
        <button disabled={pending} className="h-10 px-4 rounded-[10px] bg-[#6D28D9] text-white text-sm font-semibold disabled:opacity-60">{pending ? "Okunuyor…" : "Siparişi oluştur"}</button>
        <button type="button" onClick={() => setOpen(false)} className="text-sm text-muted">Kapat</button>
        {res && !res.ok && <span className="text-sm font-semibold text-bad">{res.message}</span>}
      </div>
    </form>
  );
}
