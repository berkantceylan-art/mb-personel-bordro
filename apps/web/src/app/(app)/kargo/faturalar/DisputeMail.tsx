"use client";
import { useState } from "react";
import { sendCarrierDispute } from "@/lib/carrier-actions";

/** Kargo firmasına itiraz e-postası: metin düzenlenebilir, kopyalanabilir, onay kutusu işaretlenince Gmail'den gönderilir */
export function DisputeMail({ carrier, months, subject: s0, body: b0, to0 }: { carrier: "dhl" | "ups"; months: number; subject: string; body: string; to0: string }) {
  const [to, setTo] = useState(to0);
  const [cc, setCc] = useState("");
  const [subject, setSubject] = useState(s0);
  const [body, setBody] = useState(b0);
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; message: string } | null>(null);
  const inp = "h-10 rounded-[10px] border border-[#D5DEE8] px-3 text-sm font-normal";
  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 md:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm font-semibold">Alıcı<input value={to} onChange={(e) => setTo(e.target.value)} className={inp} /></label>
        <label className="flex flex-col gap-1 text-sm font-semibold">Bilgi (CC)<input value={cc} onChange={(e) => setCc(e.target.value)} className={inp} placeholder="isteğe bağlı" /></label>
      </div>
      <label className="flex flex-col gap-1 text-sm font-semibold">Konu<input value={subject} onChange={(e) => setSubject(e.target.value)} className={inp} /></label>
      <label className="flex flex-col gap-1 text-sm font-semibold">Metin<textarea value={body} onChange={(e) => setBody(e.target.value)} rows={18} className="rounded-[10px] border border-[#D5DEE8] p-3 text-sm font-normal font-mono leading-relaxed" /></label>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <a href={`/kargo/faturalar/excel?ay=${months}&firma=${carrier}&kapsam=itiraz`} className="font-semibold text-brand-700">Ek: itiraz Excel&apos;ini indir</a>
        <button type="button" onClick={() => { void navigator.clipboard.writeText(`${subject}\n\n${body}`); setMsg({ ok: true, message: "Konu ve metin kopyalandı." }); }} className="h-10 px-4 rounded-[10px] border border-[#D5DEE8] text-brand-700 font-semibold">Metni kopyala</button>
        <label className="flex items-center gap-2 ml-auto"><input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} /> Metni ve alıcıyı kontrol ettim, gönderilsin</label>
        <button type="button" disabled={!ok || busy} onClick={async () => { setBusy(true); setMsg(null); try { setMsg(await sendCarrierDispute(carrier, months, { to, cc, subject, body })); setOk(false); } catch (e) { setMsg({ ok: false, message: String(e) }); } setBusy(false); }}
          className="h-10 px-5 rounded-[10px] bg-brand-700 text-white font-bold disabled:opacity-40">{busy ? "Gönderiliyor…" : "Gmail ile gönder"}</button>
      </div>
      {msg && <p className={`text-sm font-semibold ${msg.ok ? "text-ok" : "text-bad"}`}>{msg.message}</p>}
    </div>
  );
}
