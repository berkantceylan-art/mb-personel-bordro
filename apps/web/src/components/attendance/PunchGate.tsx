"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { skipGateToday, submitGate } from "@/lib/punch-gate-actions";
import type { GateItem } from "@/lib/punch-watch";

const WD = ["Pazar", "Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi"];
const dLabel = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)} ${WD[new Date(d + "T12:00:00Z").getUTCDay()]}`;

/** Eksik okutma kilidi: saat yazılmadan uygulama kullanılamaz */
export function PunchGate({ items, today }: { items: GateItem[]; today: string }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [times, setTimes] = useState(items.map(() => ""));
  const [notes, setNotes] = useState(items.map(() => ""));
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const noInToday = items.find((i) => i.kind === "NO_IN" && i.date === today);
  const send = () => start(async () => {
    const r = await submitGate(items.map((it, k) => ({ date: it.date, direction: it.direction, time: times[k] ?? "", note: notes[k] ?? "" })));
    setMsg({ ok: r.ok, text: r.message });
    if (r.ok) router.refresh();
  });
  return (
    <div className="fixed inset-0 z-[100] bg-[#06213f]/80 backdrop-blur-sm flex items-end md:items-center justify-center p-0 md:p-6" role="dialog" aria-modal="true" aria-labelledby="gate-title">
      <div className="w-full md:max-w-lg bg-white rounded-t-[22px] md:rounded-[22px] p-5 flex flex-col gap-4 max-h-[92vh] overflow-y-auto">
        <div>
          <h2 id="gate-title" className="font-display text-xl font-bold text-brand-800">Okutmanız eksik</h2>
          <p className="text-sm text-muted">Devam etmek için aşağıdaki saatleri yazın. Bildiriminiz puantaja işlenmek üzere yöneticinize gider.</p>
        </div>
        {items.map((it, k) => (
          <div key={`${it.date}|${it.direction}`} className="rounded-xl border border-[#F3C7C7] bg-[#FFF8F8] p-3 flex flex-col gap-2">
            <div className="flex flex-wrap items-baseline gap-2">
              <b className={it.direction === "IN" ? "text-ok" : "text-brand-700"}>{it.direction === "IN" ? "Giriş" : "Çıkış"}</b>
              <span className="text-sm">{dLabel(it.date)}</span>
            </div>
            <p className="text-xs text-muted">{it.reason}</p>
            <div className="flex flex-wrap gap-2">
              <label className="flex flex-col gap-1 text-xs text-muted">{it.direction === "IN" ? "Geliş saatiniz" : "Çıkış saatiniz"}
                <input type="time" required value={times[k]} onChange={(e) => setTimes(times.map((t, j) => (j === k ? e.target.value : t)))} placeholder={it.suggest} className="h-11 rounded-[10px] border border-[#D5DEE8] px-3 text-base text-ink bg-white" />
              </label>
              <button type="button" onClick={() => setTimes(times.map((t, j) => (j === k ? it.suggest : t)))} className="self-end h-11 px-3 rounded-[10px] border border-line text-xs font-semibold text-brand-700">Vardiya saati ({it.suggest})</button>
            </div>
            <input value={notes[k]} onChange={(e) => setNotes(notes.map((t, j) => (j === k ? e.target.value : t)))} placeholder="Açıklama (ör. kartımı unuttum)" maxLength={300} className="h-10 rounded-[10px] border border-[#D5DEE8] px-3 text-sm bg-white" />
          </div>
        ))}
        {msg && <p className={`text-sm font-semibold ${msg.ok ? "text-ok" : "text-bad"}`}>{msg.text}</p>}
        <button type="button" disabled={busy || times.some((t) => !t)} onClick={send} className="h-12 rounded-[12px] bg-brand-700 text-white font-semibold disabled:opacity-50">{busy ? "Gönderiliyor…" : "Bildir ve devam et"}</button>
        {noInToday && (
          <button type="button" disabled={busy} onClick={() => start(async () => { await skipGateToday(today); router.refresh(); })} className="text-sm font-semibold text-muted underline">Bugün işe gelmedim (izinli / raporlu)</button>
        )}
      </div>
    </div>
  );
}
