"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { pricesFromHistory } from "@/lib/price-history-actions";

/** Geçmiş işlerden hekime özel fiyat listesi oluştur (tek hekim ya da hepsi) */
export function PriceHistoryButton({ customerId, label }: { customerId: string | null; label: string }) {
  const [busy, setBusy] = useState(false);
  const [overwrite, setOverwrite] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const router = useRouter();
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <button type="button" disabled={busy} onClick={async () => {
        if (overwrite && !confirm("Elle girdiğiniz özel fiyatlar da geçmiş işlerdeki son fiyatla değiştirilsin mi?")) return;
        setBusy(true); setMsg(null);
        const r = await pricesFromHistory(customerId, overwrite).catch(() => ({ ok: false, message: "Sunucuya ulaşılamadı" }));
        setBusy(false); setMsg({ ok: r.ok, text: r.message }); if (r.ok) router.refresh();
      }} className="h-10 px-4 rounded-[10px] border border-[#D5DEE8] bg-white font-semibold text-brand-700 disabled:opacity-50">{busy ? "Hazırlanıyor…" : label}</button>
      <label className="flex items-center gap-1.5 text-xs text-muted"><input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} />mevcut özel fiyatları da güncelle</label>
      {msg && <span role="status" className={msg.ok ? "text-ok font-semibold" : "text-bad font-semibold"}>{msg.text}</span>}
    </div>
  );
}
