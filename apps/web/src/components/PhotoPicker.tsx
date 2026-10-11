"use client";
import { useRef, useState } from "react";

/** Fotoğrafı tarayıcıda küçültüp JPEG dataURL'e çevirir (en uzun kenar 1280 px) */
export async function compressImage(file: File, max = 1280, q = 0.72): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const k = Math.min(1, max / Math.max(img.width, img.height));
    const c = document.createElement("canvas");
    c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
    c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
    let out = c.toDataURL("image/jpeg", q);
    if (out.length > 880000) out = c.toDataURL("image/jpeg", 0.5);
    return out;
  } finally { URL.revokeObjectURL(url); }
}

/** Kamera / galeriden fotoğraf seç; küçültülmüş önizlemeler */
export function PhotoPicker({ value, onChange, max = 4, label = "📷 Fotoğraf ekle" }: { value: string[]; onChange: (v: string[]) => void; max?: number; label?: string }) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-2">
      {value.map((src, i) => (
        <span key={i} className="relative">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt={`Fotoğraf ${i + 1}`} className="h-20 w-20 rounded-xl border border-line object-cover" />
          <button type="button" onClick={() => onChange(value.filter((_, j) => j !== i))} className="absolute -right-1.5 -top-1.5 grid h-6 w-6 place-items-center rounded-full bg-bad text-xs text-white" aria-label="Fotoğrafı kaldır">✕</button>
        </span>
      ))}
      {value.length < max && (
        <button type="button" disabled={busy} onClick={() => ref.current?.click()} className="grid h-20 min-w-20 place-items-center rounded-xl border-2 border-dashed border-[#C5D0DB] px-3 text-sm font-semibold text-brand-700">{busy ? "…" : label}</button>
      )}
      <input ref={ref} type="file" accept="image/*" capture="environment" multiple hidden onChange={async (e) => {
        const files = Array.from(e.target.files ?? []).slice(0, max - value.length);
        e.target.value = "";
        if (!files.length) return;
        setBusy(true);
        try { onChange([...value, ...(await Promise.all(files.map((f) => compressImage(f))))].slice(0, max)); } finally { setBusy(false); }
      }} />
    </div>
  );
}
