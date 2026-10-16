"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { jobPostpone } from "@/lib/postpone-actions";
import { POSTPONE_REASONS, nextWorkday, todayTR } from "@/lib/postpone";

const inp = "h-10 rounded-[10px] border border-[#D5DEE8] px-2 bg-white text-sm";

/** Tarih + sebep + not ile erteleme. Tek iş için düğme, toplu için seçili kimliklerle kullanılır. */
export function PostponeForm({ ids, compact, onDone, label }: { ids: string[]; compact?: boolean; onDone?: () => void; label?: string }) {
  const [open, setOpen] = useState(!compact);
  const [to, setTo] = useState(nextWorkday());
  const [reason, setReason] = useState("capacity");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const router = useRouter();
  const t = todayTR();
  const quick = [["Yarın", nextWorkday(t, 1)], ["+2 gün", nextWorkday(t, 2)], ["+3 gün", nextWorkday(t, 3)]] as const;

  if (!open) return <button type="button" onClick={() => setOpen(true)} className="h-10 px-3 rounded-[10px] border border-[#F2C38B] bg-[#FFF7ED] text-sm font-semibold text-[#9A3412]">⏭ Ertele</button>;

  async function go() {
    setBusy(true); setMsg(null);
    const r = await jobPostpone(ids, to, reason, note).catch(() => ({ ok: false, message: "Sunucuya ulaşılamadı" }));
    setMsg({ ok: r.ok, text: r.message });
    setBusy(false);
    if (r.ok) { setNote(""); onDone?.(); router.refresh(); }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex gap-1" role="group" aria-label="Hızlı tarih">
        {quick.map(([l, d]) => (
          <button key={l} type="button" onClick={() => setTo(d)} className={`h-10 px-2.5 rounded-[10px] text-xs font-semibold border ${to === d ? "bg-brand-700 text-white border-brand-700" : "bg-white border-[#D5DEE8] text-brand-700"}`}>{l}</button>
        ))}
      </div>
      <input type="date" value={to} min={t} onChange={(e) => setTo(e.target.value)} className={inp} aria-label="Yeni teslim tarihi" />
      <select value={reason} onChange={(e) => setReason(e.target.value)} className={inp} aria-label="Sebep">
        {Object.entries(POSTPONE_REASONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
      </select>
      <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Not (isteğe bağlı)" className={`${inp} w-44`} maxLength={500} />
      <button type="button" disabled={busy || !ids.length} onClick={go} className="h-10 px-4 rounded-[10px] bg-[#C2410C] text-white text-sm font-bold disabled:opacity-50">
        {busy ? "Erteleniyor…" : label ?? (ids.length > 1 ? `${ids.length} işi ertele` : "Ertele")}
      </button>
      {compact && <button type="button" onClick={() => setOpen(false)} className="text-xs text-muted">Vazgeç</button>}
      {msg && <span role="status" className={`text-sm rounded-lg px-3 py-1.5 ${msg.ok ? "bg-ok-bg text-ok" : "bg-bad-bg text-bad"}`}>{msg.text}</span>}
    </div>
  );
}
