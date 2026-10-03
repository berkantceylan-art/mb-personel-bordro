"use client";
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";

export interface SignaturePadHandle {
  clear: () => void;
  toDataURL: () => string;
}

/** Dokunmatik / fare imza alanı. Boşsa toDataURL "" döner. */
export const SignaturePad = forwardRef<SignaturePadHandle, { onChange?: (dataUrl: string) => void }>(
  function SignaturePad({ onChange }, ref) {
    const canvas = useRef<HTMLCanvasElement>(null);
    const drawing = useRef(false);
    const dirty = useRef(false);

    useEffect(() => {
      const c = canvas.current!;
      const ratio = window.devicePixelRatio || 1;
      c.width = c.offsetWidth * ratio;
      c.height = c.offsetHeight * ratio;
      const ctx = c.getContext("2d")!;
      ctx.scale(ratio, ratio);
      ctx.lineWidth = 2.5;
      ctx.lineCap = "round";
      ctx.strokeStyle = "#0A2540";
    }, []);

    const pos = (e: React.PointerEvent) => {
      const r = canvas.current!.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };

    useImperativeHandle(ref, () => ({
      clear() {
        const c = canvas.current!;
        c.getContext("2d")!.clearRect(0, 0, c.width, c.height);
        dirty.current = false;
      },
      toDataURL: () => (dirty.current ? canvas.current!.toDataURL("image/png") : ""),
    }));

    return (
      <canvas
        ref={canvas}
        aria-label="İmza alanı"
        className="w-full h-40 rounded-xl border-2 border-dashed border-[#C5D0DC] bg-[#FBFCFD] touch-none"
        onPointerDown={(e) => {
          drawing.current = true;
          const ctx = canvas.current!.getContext("2d")!;
          const p = pos(e);
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          canvas.current!.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!drawing.current) return;
          const ctx = canvas.current!.getContext("2d")!;
          const p = pos(e);
          ctx.lineTo(p.x, p.y);
          ctx.stroke();
          dirty.current = true;
        }}
        onPointerUp={() => {
          drawing.current = false;
          if (dirty.current) onChange?.(canvas.current!.toDataURL("image/png"));
        }}
      />
    );
  },
);
