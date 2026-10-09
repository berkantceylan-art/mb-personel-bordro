"use client";
import { useEffect, useRef, useState } from "react";
import { PendingSubmit } from "@/components/ConfirmSubmit";

/** Parmakla imza: canvas → PNG (gizli alan) */
export function SignaturePad({ action, hidden }: { action: (f: FormData) => Promise<void>; hidden: Record<string, string> }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [drawn, setDrawn] = useState(false);
  const [data, setData] = useState("");
  useEffect(() => {
    const c = canvas.current!; const ctx = c.getContext("2d")!;
    const dpr = window.devicePixelRatio || 1; const w = c.clientWidth; const h = 200;
    c.width = w * dpr; c.height = h * dpr; ctx.scale(dpr, dpr);
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h); ctx.lineWidth = 2.5; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.strokeStyle = "#0A2A50";
    let down = false; let last: [number, number] | null = null;
    const pos = (e: PointerEvent) => { const r = c.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top] as [number, number]; };
    const start = (e: PointerEvent) => { down = true; last = pos(e); c.setPointerCapture(e.pointerId); e.preventDefault(); };
    const move = (e: PointerEvent) => { if (!down || !last) return; const p = pos(e); ctx.beginPath(); ctx.moveTo(last[0], last[1]); ctx.lineTo(p[0], p[1]); ctx.stroke(); last = p; setDrawn(true); e.preventDefault(); };
    const end = () => { down = false; last = null; setData(c.toDataURL("image/png")); };
    c.addEventListener("pointerdown", start); c.addEventListener("pointermove", move); c.addEventListener("pointerup", end); c.addEventListener("pointercancel", end);
    return () => { c.removeEventListener("pointerdown", start); c.removeEventListener("pointermove", move); c.removeEventListener("pointerup", end); c.removeEventListener("pointercancel", end); };
  }, []);
  const clear = () => { const c = canvas.current!; const ctx = c.getContext("2d")!; ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height); ctx.restore(); setDrawn(false); setData(""); };
  return (
    <form action={action} className="flex flex-col gap-3">
      {Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <input type="hidden" name="signature" value={data} />
      <input type="hidden" name="drawn" value={drawn && data ? "1" : "0"} />
      <label className="flex gap-3 items-start text-sm"><input type="checkbox" name="consent" required className="w-5 h-5 mt-0.5" /><span>Yukarıdaki belgeyi okudum, anladım ve kabul ediyorum. Aşağıdaki imzam ıslak imzam yerine geçer.</span></label>
      <div className="rounded-xl border-2 border-dashed border-[#C5D0DC] bg-white overflow-hidden">
        <canvas ref={canvas} className="w-full h-[200px] touch-none" aria-label="İmza alanı" />
      </div>
      <div className="flex gap-2 flex-wrap items-center">
        <PendingSubmit className={`h-12 px-5 rounded-[10px] text-white font-semibold ${drawn ? "bg-brand-700" : "bg-[#C5D0DC]"}`}>İmzala ve gönder</PendingSubmit>
        <button type="button" onClick={clear} className="h-12 px-3 text-sm font-semibold text-muted">Temizle</button>
        {!drawn && <span className="text-xs text-muted">Parmağınızla kutuya imza atın.</span>}
      </div>
    </form>
  );
}
