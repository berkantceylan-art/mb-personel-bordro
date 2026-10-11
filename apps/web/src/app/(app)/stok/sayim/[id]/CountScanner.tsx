"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { scanCount } from "@/lib/stock-actions";

type Log = { ok: boolean; text: string; at: string };

/** Sayımda barkod / kod okutma: kamera ya da el tipi okuyucu (klavye gibi yazar + Enter). Her okutma miktarı üzerine ekler. */
export function CountScanner({ countId }: { countId: string }) {
  const router = useRouter();
  const video = useRef<HTMLVideoElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const stopRef = useRef<(() => void) | null>(null);
  const lastRef = useRef<{ code: string; t: number }>({ code: "", t: 0 });
  const [on, setOn] = useState(false);
  const [code, setCode] = useState("");
  const [qtyIn, setQty] = useState("1");
  const [lot, setLot] = useState("");
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<Log[]>([]);

  useEffect(() => () => stopRef.current?.(), []);

  async function submit(value: string) {
    const v = value.trim();
    if (!v || busy) return;
    setBusy(true);
    const q = Number(qtyIn.replace(",", ".")) || 1;
    const r = await scanCount(countId, v, q, lot || null);
    setBusy(false);
    setCode("");
    setLog((l) => [{ ok: r.ok, text: r.ok ? `+${q} → ${r.message}` : `${v}: ${r.message}`, at: new Date().toLocaleTimeString("tr-TR") }, ...l].slice(0, 30));
    if (r.ok) { if (navigator.vibrate) navigator.vibrate(60); router.refresh(); }
    else if (navigator.vibrate) navigator.vibrate([80, 60, 80]);
    input.current?.focus();
  }

  async function start() {
    try {
      const { BrowserMultiFormatReader } = await import("@zxing/browser");
      const reader = new BrowserMultiFormatReader();
      setOn(true);
      const controls = await reader.decodeFromConstraints({ video: { facingMode: { ideal: "environment" } } }, video.current!, (result) => {
        if (!result) return;
        const text = result.getText();
        // aynı barkod 2 sn içinde ikinci kez sayılmasın
        const now = Date.now();
        if (lastRef.current.code === text && now - lastRef.current.t < 2000) return;
        lastRef.current = { code: text, t: now };
        void submit(text);
      });
      stopRef.current = () => controls.stop();
    } catch {
      setOn(false);
      setLog((l) => [{ ok: false, text: "Kamera açılamadı: tarayıcıya kamera izni verin ya da kodu yazın.", at: new Date().toLocaleTimeString("tr-TR") }, ...l]);
    }
  }

  function stop() {
    stopRef.current?.();
    setOn(false);
  }

  return (
    <section className="bg-white border border-line rounded-[14px] p-4 flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <h2 className="font-semibold">Okutarak say</h2>
        <span className="text-xs text-muted">El tipi barkod okuyucu da çalışır: kutucuğa tıklayın ve okutun.</span>
        <button type="button" onClick={on ? stop : start} className="ml-auto h-9 px-3 rounded-[10px] border border-[#D5DEE8] text-sm font-semibold">{on ? "Kamerayı kapat" : "📷 Kamera"}</button>
      </div>
      <div className={`relative rounded-xl overflow-hidden bg-black aspect-[16/9] max-h-[40vh] ${on ? "" : "hidden"}`}>
        <video ref={video} className="w-full h-full object-cover" muted playsInline />
        <div className="absolute inset-x-8 top-1/2 h-0.5 bg-red-500/80" aria-hidden="true" />
      </div>
      <form onSubmit={(e) => { e.preventDefault(); void submit(code); }} className="grid gap-2 grid-cols-[1fr_90px] sm:grid-cols-[1fr_90px_160px_auto]">
        <input ref={input} autoFocus value={code} onChange={(e) => setCode(e.target.value)} placeholder="Barkod ya da stok kodu" className="h-12 rounded-[10px] border border-[#D5DEE8] px-3 bg-white font-mono text-base" />
        <input value={qtyIn} onChange={(e) => setQty(e.target.value)} inputMode="decimal" aria-label="Miktar" className="h-12 rounded-[10px] border border-[#D5DEE8] px-3 bg-white text-right" />
        <input value={lot} onChange={(e) => setLot(e.target.value)} placeholder="Lot (lot takipliyse)" className="h-12 rounded-[10px] border border-[#D5DEE8] px-3 bg-white col-span-2 sm:col-span-1" />
        <button disabled={busy} className="h-12 px-5 rounded-[10px] bg-brand-700 text-white font-semibold disabled:opacity-60 col-span-2 sm:col-span-1">{busy ? "…" : "Ekle"}</button>
      </form>
      {log.length > 0 && (
        <ul className="text-sm max-h-48 overflow-y-auto divide-y divide-[#EEF2F6]">
          {log.map((l, i) => <li key={i} className={`py-1.5 flex gap-3 ${l.ok ? "" : "text-bad"}`}><span className="text-muted num">{l.at}</span>{l.text}</li>)}
        </ul>
      )}
    </section>
  );
}
