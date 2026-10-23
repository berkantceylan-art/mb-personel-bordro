"use client";
import { useEffect, useRef, useState } from "react";

/** Dokunmatik (telefon / tablet) cihazda telefonun kendi kamera uygulaması daha iyi; bilgisayarda canlı kamera penceresi açılır */
export const isTouchDevice = () => typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches;

/**
 * Bilgisayardaki web kamerasıyla canlı çekim. `capture` niteliği masaüstü tarayıcılarda yok sayıldığı için
 * (dosya seçme penceresi açılır) burada getUserMedia ile görüntü alınır. Pencere açık kaldıkça art arda çekilebilir.
 */
export function LiveCamera({ open, onClose, onShot }: { open: boolean; onClose: () => void; onShot: (f: File) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [count, setCount] = useState(0);
  const [flash, setFlash] = useState(false);

  useEffect(() => {
    if (!open) return;
    let off = false;
    setErr(null);
    setCount(0);
    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error("unsupported");
        const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
        if (off) { s.getTracks().forEach((t) => t.stop()); return; }
        stream.current = s;
        if (video.current) { video.current.srcObject = s; await video.current.play().catch(() => null); }
      } catch (e) {
        const n = (e as { name?: string }).name ?? (e as Error).message;
        setErr(/NotFound|DevicesNotFound|OverconstrainedError/i.test(n) ? "Bu bilgisayarda kamera bulunamadı. Telefondan ERP'yi açıp çekebilir ya da tarayıcı (scanner) kullanabilirsiniz."
          : /NotAllowed|Permission|Security/i.test(n) ? "Kamera izni verilmedi. Adres çubuğundaki kamera simgesinden izin verip yeniden deneyin."
          : /NotReadable|TrackStart/i.test(n) ? "Kamera başka bir uygulama tarafından kullanılıyor (Zoom, Teams vb.). Kapatıp yeniden deneyin."
          : "Bu tarayıcı kamerayı açamadı. Chrome ya da Edge ile deneyin.");
      }
    })();
    return () => { off = true; stream.current?.getTracks().forEach((t) => t.stop()); stream.current = null; };
  }, [open]);

  if (!open) return null;

  const shoot = () => {
    const v = video.current;
    if (!v || !v.videoWidth) return;
    const c = document.createElement("canvas");
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext("2d")!.drawImage(v, 0, 0);
    c.toBlob((b) => {
      if (!b) return;
      onShot(new File([b], `kamera-${Date.now()}.jpg`, { type: "image/jpeg" }));
      setCount((n) => n + 1);
      setFlash(true);
      setTimeout(() => setFlash(false), 150);
    }, "image/jpeg", 0.92);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="bg-white rounded-[16px] w-full max-w-3xl overflow-hidden flex flex-col">
        <div className="relative bg-black aspect-video">
          <video ref={video} playsInline muted className="w-full h-full object-contain" />
          {flash && <div className="absolute inset-0 bg-white/70" />}
          {err && <div className="absolute inset-0 grid place-items-center p-6 text-center text-white text-sm">{err}</div>}
        </div>
        <div className="flex items-center gap-3 p-3">
          <button type="button" onClick={shoot} disabled={!!err} className="h-14 flex-1 rounded-[12px] bg-brand-700 text-white font-bold text-lg disabled:opacity-50">📷 Çek{count ? ` (${count})` : ""}</button>
          <button type="button" onClick={onClose} className="h-14 px-6 rounded-[12px] border-2 border-line font-bold">{count ? "Bitti" : "Kapat"}</button>
        </div>
        <p className="px-3 pb-3 text-xs text-muted">Belgeyi düz bir zemine koyup kameraya tutun, art arda çekebilirsiniz. Çektikleriniz pencere kapanınca listede görünür.</p>
      </div>
    </div>
  );
}
