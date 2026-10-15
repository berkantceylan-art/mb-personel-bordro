"use client";
import { useState } from "react";
import { doorManual } from "@/lib/door-actions";

/** Kapıyı elle aç (güvenlik / yönetici). Röle Erom panelinin çıkış butonu uçlarını kısa süre kapatır. */
export function DoorButton({ branchId, label = "🔓 Kapıyı aç", big }: { branchId: string; label?: string; big?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button type="button" disabled={busy}
        onClick={async () => {
          setBusy(true); setMsg(null);
          const r = await doorManual(branchId).catch(() => ({ ok: false, message: "Sunucuya ulaşılamadı" }));
          setMsg({ ok: r.ok, text: r.ok ? "Kapı açıldı" : r.message });
          setBusy(false);
          setTimeout(() => setMsg(null), 8000);
        }}
        className={`${big ? "h-14 px-6 text-base" : "h-11 px-4 text-sm"} rounded-[12px] bg-[#1E7A4C] text-white font-bold disabled:opacity-60`}>
        {busy ? "Açılıyor…" : label}
      </button>
      {msg && <span role="status" className={`text-sm rounded-lg px-3 py-1.5 ${msg.ok ? "bg-ok-bg text-ok" : "bg-bad-bg text-bad"}`}>{msg.text}</span>}
    </span>
  );
}
