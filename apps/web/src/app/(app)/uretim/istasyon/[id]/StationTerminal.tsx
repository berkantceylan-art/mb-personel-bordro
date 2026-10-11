"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { scanJob, type ScanResult } from "@/lib/production-actions";

/** İstasyon terminali (tablet): teknisyen seç, iş föyündeki QR'ı / numarayı okut → başla, tekrar okut → bitir */
export function StationTerminal({ stationId, employees }: { stationId: string; employees: { id: string; name: string }[] }) {
  const router = useRouter();
  const [emp, setEmp] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [on, setOn] = useState(false);
  const [log, setLog] = useState<(ScanResult & { at: string })[]>([]);
  const input = useRef<HTMLInputElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const stop = useRef<(() => void) | null>(null);
  const last = useRef({ code: "", t: 0 });

  useEffect(() => {
    try { setEmp(localStorage.getItem(`prd-emp-${stationId}`) ?? ""); } catch { /* yok */ }
    return () => stop.current?.();
  }, [stationId]);

  async function submit(v: string) {
    const c = v.trim();
    if (!c || busy) return;
    setBusy(true);
    const r = await scanJob(c, stationId, emp || null);
    setBusy(false);
    setCode("");
    setLog((l) => [{ ...r, at: new Date().toLocaleTimeString("tr-TR") }, ...l].slice(0, 20));
    if (navigator.vibrate) navigator.vibrate(r.ok ? 60 : [80, 60, 80]);
    if (r.ok) router.refresh();
    input.current?.focus();
  }

  async function camera() {
    if (on) { stop.current?.(); setOn(false); return; }
    try {
      const { BrowserMultiFormatReader } = await import("@zxing/browser");
      setOn(true);
      const controls = await new BrowserMultiFormatReader().decodeFromConstraints({ video: { facingMode: { ideal: "environment" } } }, video.current!, (res) => {
        if (!res) return;
        const t = res.getText(), n = Date.now();
        if (last.current.code === t && n - last.current.t < 4000) return;
        last.current = { code: t, t: n };
        void submit(t);
      });
      stop.current = () => controls.stop();
    } catch { setOn(false); }
  }

  const lastR = log[0];
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-3 items-end">
        <label className="flex flex-col gap-1 text-sm font-semibold">Teknisyen
          <select value={emp} onChange={(e) => { setEmp(e.target.value); try { localStorage.setItem(`prd-emp-${stationId}`, e.target.value); } catch { /* yok */ } }} className="h-12 rounded-[10px] border border-[#D5DEE8] px-3 bg-white min-w-56">
            <option value="">Giriş yapan kullanıcı</option>{employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
        </label>
        <button type="button" onClick={camera} className="h-12 px-4 rounded-[10px] border border-[#D5DEE8] bg-white font-semibold">{on ? "Kamerayı kapat" : "📷 Kamera ile okut"}</button>
      </div>
      <div className={`relative rounded-2xl overflow-hidden bg-black aspect-[16/9] max-h-[40vh] ${on ? "" : "hidden"}`}>
        <video ref={video} className="w-full h-full object-cover" muted playsInline />
        <div className="absolute inset-x-10 top-1/2 h-0.5 bg-red-500/80" />
      </div>
      <form onSubmit={(e) => { e.preventDefault(); void submit(code); }} className="flex gap-2">
        <input ref={input} autoFocus value={code} onChange={(e) => setCode(e.target.value)} placeholder="İş no ya da föydeki QR (el okuyucu da olur)" className="h-16 flex-1 rounded-[12px] border-2 border-brand-600 px-4 text-2xl font-mono bg-white" />
        <button disabled={busy} className="h-16 px-6 rounded-[12px] bg-brand-700 text-white text-lg font-bold disabled:opacity-60">{busy ? "…" : "Okut"}</button>
      </form>
      {lastR && (
        <div className={`rounded-[14px] p-4 text-lg font-semibold ${!lastR.ok ? "bg-bad-bg text-bad" : lastR.action === "started" ? "bg-[#EAF2FB] text-brand-700" : lastR.action === "finished" ? "bg-ok-bg text-ok" : "bg-warn-bg text-warn"}`}>
          {lastR.ok ? (lastR.action === "started" ? "▶ " : lastR.action === "finished" ? "✔ " : "ℹ ") : "✖ "}{lastR.message}
          {lastR.warnings && lastR.warnings.length > 0 && <span className="block text-sm text-bad mt-1">Stok yetersiz: {lastR.warnings.map((w) => `${w.item} (${w.missing} ${w.unit})`).join(", ")}</span>}
        </div>
      )}
      {log.length > 1 && (
        <ul className="text-sm divide-y divide-[#EEF2F6] bg-white border border-line rounded-[12px] px-3">
          {log.slice(1).map((l, i) => <li key={i} className={`py-1.5 flex gap-3 ${l.ok ? "" : "text-bad"}`}><span className="text-muted num">{l.at}</span>{l.message}</li>)}
        </ul>
      )}
    </div>
  );
}
