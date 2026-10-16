"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { emailRfq, markRfqSent } from "@/lib/rfq-actions";
import { SUP_STATUS } from "@/lib/rfq";

type Row = { id: string; name: string; status: string; sent: boolean; link: string; email: string | null; wa: string | null };

/** Tedarikçilere teklif bağlantısını gönder: e-posta (toplu), WhatsApp, bağlantıyı kopyala */
export function RfqSend({ rfqId, rows }: { rfqId: string; rows: Row[] }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const router = useRouter();
  const pending = rows.filter((r) => !r.sent && r.email);
  async function mail(ids: string[]) {
    setBusy(true); setMsg(null);
    const r = await emailRfq(rfqId, ids).catch(() => ({ ok: false, message: "Sunucuya ulaşılamadı" }));
    setBusy(false); setMsg({ ok: r.ok, text: r.message }); router.refresh();
  }
  return (
    <section className="rounded-[16px] border border-line bg-white p-4 flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-display font-bold mr-auto">Tedarikçilere gönder</h2>
        {pending.length > 0 && <button type="button" disabled={busy} onClick={() => mail(pending.map((r) => r.id))} className="h-10 px-4 rounded-[10px] bg-brand-700 text-white text-sm font-semibold disabled:opacity-50">{busy ? "Gönderiliyor…" : `✉ Gönderilmemiş ${pending.length} tedarikçiye e-posta at`}</button>}
      </div>
      {msg && <p className={`text-sm rounded-lg px-3 py-2 ${msg.ok ? "bg-ok-bg text-ok" : "bg-bad-bg text-bad"}`}>{msg.text}</p>}
      <ul className="flex flex-col divide-y divide-[#EEF2F6]">
        {rows.map((r) => (
          <li key={r.id} className="py-2 flex flex-wrap items-center gap-2 text-sm">
            <b className="min-w-48">{r.name}</b>
            <span className={`text-[11px] font-semibold rounded px-1.5 py-0.5 ${SUP_STATUS[r.status]?.[1]}`}>{SUP_STATUS[r.status]?.[0]}</span>
            {r.sent && <span className="text-xs text-ok">✓ gönderildi</span>}
            <span className="ml-auto flex flex-wrap gap-1.5">
              <button type="button" onClick={() => { void navigator.clipboard.writeText(r.link); setCopied(r.id); void markRfqSent([r.id]); }} className="h-8 px-2.5 rounded-[8px] border border-line text-xs font-semibold">{copied === r.id ? "✓ Kopyalandı" : "Bağlantıyı kopyala"}</button>
              {r.wa && <a href={r.wa} target="_blank" rel="noreferrer" onClick={() => { void markRfqSent([r.id]); setTimeout(() => router.refresh(), 800); }} className="h-8 px-2.5 inline-flex items-center rounded-[8px] border border-[#25D366] text-[#128C7E] text-xs font-semibold">WhatsApp</a>}
              {r.email ? <button type="button" disabled={busy} onClick={() => mail([r.id])} className="h-8 px-2.5 rounded-[8px] border border-line text-xs font-semibold">✉ E-posta</button> : <span className="text-[11px] text-muted self-center">e-posta yok</span>}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
