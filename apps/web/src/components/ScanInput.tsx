"use client";
import { useEffect, useRef, useState } from "react";

/** Okuma sesi (kısa bip) ve titreşim */
export function scanFeedback(ok = true) {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = ok ? 1250 : 320;
    g.gain.value = 0.08;
    o.connect(g); g.connect(ctx.destination);
    o.start(); o.stop(ctx.currentTime + (ok ? 0.09 : 0.3));
    o.onended = () => void ctx.close();
  } catch { /* ses yok */ }
  if (navigator.vibrate) navigator.vibrate(ok ? 60 : [120, 60, 120]);
}

/**
 * Barkod / QR okutma: el okuyucu (klavye gibi yazıp Enter) her zaman çalışır; istenirse telefon kamerası sürekli okur.
 * Aynı kod 1,5 sn içinde tekrar okunmaz (kamera titremesi).
 */
export function ScanInput({ onCode, placeholder = "Barkodu okutun ya da yazın", busy = false, autoFocus = true }: { onCode: (code: string) => void | Promise<void>; placeholder?: string; busy?: boolean; autoFocus?: boolean }) {
  const video = useRef<HTMLVideoElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const stopRef = useRef<(() => void) | null>(null);
  const last = useRef<{ code: string; at: number }>({ code: "", at: 0 });
  const cb = useRef(onCode);
  cb.current = onCode;
  const [cam, setCam] = useState(false);
  const [val, setVal] = useState("");
  const [err, setErr] = useState("");

  useEffect(() => () => stopRef.current?.(), []);

  const fire = (raw: string) => {
    const code = raw.trim();
    if (!code) return;
    const now = Date.now();
    if (code === last.current.code && now - last.current.at < 1500) return;
    last.current = { code, at: now };
    void cb.current(code);
  };

  async function startCam() {
    setErr("");
    try {
      const { BrowserMultiFormatReader } = await import("@zxing/browser");
      const reader = new BrowserMultiFormatReader();
      setCam(true);
      const controls = await reader.decodeFromConstraints({ video: { facingMode: { ideal: "environment" } } }, video.current!, (result) => {
        if (result) fire(result.getText());
      });
      stopRef.current = () => controls.stop();
    } catch {
      setCam(false);
      setErr("Kamera açılamadı. Tarayıcıya kamera izni verin ya da el okuyucu kullanın.");
    }
  }
  function stopCam() { stopRef.current?.(); stopRef.current = null; setCam(false); input.current?.focus(); }

  return (
    <div className="flex flex-col gap-2">
      <form onSubmit={(e) => { e.preventDefault(); fire(val); last.current.at = 0; setVal(""); }} className="flex gap-2">
        <div className="relative flex-1">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-lg">⌁</span>
          <input ref={input} value={val} onChange={(e) => setVal(e.target.value)} autoFocus={autoFocus} placeholder={placeholder} autoComplete="off" autoCapitalize="characters" inputMode="text"
            className="h-14 w-full rounded-[12px] border-2 border-brand-600/40 bg-white pl-9 pr-3 font-mono text-lg focus:border-brand-600 focus:outline-none" />
        </div>
        <button disabled={busy || !val.trim()} className="h-14 rounded-[12px] bg-brand-700 px-5 font-semibold text-white disabled:opacity-50">{busy ? "…" : "Ekle"}</button>
        <button type="button" onClick={cam ? stopCam : startCam} className={`h-14 rounded-[12px] px-4 text-xl ${cam ? "bg-bad text-white" : "border border-line bg-white"}`} aria-label={cam ? "Kamerayı kapat" : "Kamerayla okut"} title={cam ? "Kamerayı kapat" : "Kamerayla okut"}>{cam ? "✕" : "📷"}</button>
      </form>
      <div className={`relative overflow-hidden rounded-2xl bg-black ${cam ? "aspect-[16/9] max-h-[40vh]" : "hidden"}`}>
        <video ref={video} className="h-full w-full object-cover" muted playsInline />
        <div className="pointer-events-none absolute inset-x-[12%] top-1/2 h-0.5 -translate-y-1/2 bg-red-500/80 shadow-[0_0_12px_red]" aria-hidden="true" />
        <span className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-black/60 px-3 py-1 text-xs text-white">Sürekli okuma açık · ürünleri sırayla gösterin</span>
      </div>
      {err && <p className="text-sm text-bad">{err}</p>}
    </div>
  );
}
