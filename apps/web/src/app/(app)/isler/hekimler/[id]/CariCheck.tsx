"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { removeDsisOpening } from "@/lib/cari-fix-actions";

export type CariLine = { label: string; value: string; tone?: "warn" | "bad" | "muted" };

/** Cari bakiyesinin dökümü + Dentalsis devir kaydını kaldırma */
export function CariCheck({ customerId, lines, hasDsis }: { customerId: string; lines: CariLine[]; hasDsis: boolean }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const router = useRouter();
  return (
    <div className="flex flex-col gap-3">
      <dl className="grid gap-1 text-sm">
        {lines.map((l) => (
          <div key={l.label} className={`flex justify-between gap-3 border-b border-[#EEF2F6] py-1 ${l.tone === "bad" ? "text-bad font-semibold" : l.tone === "warn" ? "text-[#9A3412]" : l.tone === "muted" ? "text-muted" : ""}`}>
            <dt>{l.label}</dt><dd className="num whitespace-nowrap">{l.value}</dd>
          </div>
        ))}
      </dl>
      {hasDsis && (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" disabled={busy} onClick={async () => {
            if (!confirm("Dentalsis aktarımında açılan devir / eşitleme kaydı bu cariden kaldırılsın mı? Gerçek işler ve tahsilatlar değişmez.")) return;
            setBusy(true); const r = await removeDsisOpening(customerId); setBusy(false); setMsg({ ok: r.ok, text: r.message }); if (r.ok) router.refresh();
          }} className="h-10 px-4 rounded-[10px] border border-[#F2C38B] bg-[#FFF7ED] text-sm font-semibold text-[#9A3412] disabled:opacity-50">{busy ? "…" : "Dentalsis devir kaydını kaldır"}</button>
          <span className="text-xs text-muted">Devir yanlışsa kullanın; doğru devri sonra “Tahsilat” ya da iş olarak elle girebilirsiniz.</span>
        </div>
      )}
      {msg && <p role="status" className={`text-sm rounded-lg px-3 py-1.5 ${msg.ok ? "bg-ok-bg text-ok" : "bg-bad-bg text-bad"}`}>{msg.text}</p>}
    </div>
  );
}
