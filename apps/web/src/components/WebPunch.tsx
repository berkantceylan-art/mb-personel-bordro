"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Result = { direction: string; at: string; branch: string };

/** Telefonun tarayıcısından konumla ya da QR kodla giriş/çıkış */
export function WebPunch({ inside }: { inside?: boolean }) {
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [scan, setScan] = useState(false);
  const [dir, setDir] = useState<"IN" | "OUT">(inside ? "OUT" : "IN");
  const router = useRouter();

  async function send(args: { p_lat: number | null; p_lng: number | null; p_accuracy: number | null; p_qr: string | null }) {
    let res = await createClient().rpc("mobile_punch", { ...args, p_direction: dir });
    // Eski sunucu sürümü (yön parametresi yoksa): otomatik yön
    if (res.error && /p_direction/.test(res.error.message)) res = await createClient().rpc("mobile_punch", args);
    const { data, error } = res;
    if (error) return setMsg({ ok: false, text: error.message });
    const d = data as Result;
    setMsg({ ok: true, text: `${d.direction === "IN" ? "Giriş" : "Çıkış"} kaydedildi · ${d.at.slice(11, 16)} · ${d.branch}` });
    if ("vibrate" in navigator) navigator.vibrate(80);
    router.refresh();
  }

  function punchLocation() {
    if (!navigator.geolocation) return setMsg({ ok: false, text: "Tarayıcınız konum desteklemiyor; QR ile okutun." });
    setBusy(true);
    setMsg(null);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        await send({ p_lat: pos.coords.latitude, p_lng: pos.coords.longitude, p_accuracy: pos.coords.accuracy, p_qr: null });
        setBusy(false);
      },
      (e) => {
        setBusy(false);
        setMsg({ ok: false, text: e.code === 1 ? "Konum izni verilmedi. Telefon ayarlarından izin verin ya da QR ile okutun." : "Konum alınamadı, tekrar deneyin." });
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  }

  return (
    <div className="flex flex-col gap-3 w-full">
      <div className="grid grid-cols-2 gap-2 p-1 rounded-[14px] bg-[#EEF2F6]" role="group" aria-label="Yön">
        {(["IN", "OUT"] as const).map((d) => (
          <button key={d} type="button" onClick={() => setDir(d)} aria-pressed={dir === d}
            className={`h-11 rounded-[11px] font-bold text-sm ${dir === d ? (d === "IN" ? "bg-[#1E7A4C] text-white" : "bg-[#B42318] text-white") : "text-[#33414F]"}`}>
            {d === "IN" ? "Giriş" : "Çıkış"}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <button onClick={punchLocation} disabled={busy} className={`h-14 px-6 rounded-[14px] text-white font-bold text-base disabled:opacity-60 ${dir === "IN" ? "bg-accent" : "bg-[#B42318]"}`}>
          {busy ? "Konum alınıyor…" : dir === "IN" ? "Giriş yap (konumla)" : "Çıkış yap (konumla)"}
        </button>
        <button onClick={() => { setMsg(null); setScan(true); }} className="h-14 px-6 rounded-[14px] border border-[#D5DEE8] bg-white text-brand-700 font-bold text-base">
          {dir === "IN" ? "Giriş yap (QR okut)" : "Çıkış yap (QR okut)"}
        </button>
      </div>
      {msg && <span role="status" className={`text-sm rounded-lg px-3 py-2 ${msg.ok ? "bg-ok-bg text-ok" : "bg-bad-bg text-bad"}`}>{msg.text}</span>}
      {scan && (
        <QrScanner
          onClose={() => setScan(false)}
          onCode={async (code) => {
            setScan(false);
            await send({ p_lat: null, p_lng: null, p_accuracy: null, p_qr: code });
          }}
        />
      )}
    </div>
  );
}

function QrScanner({ onCode, onClose }: { onCode: (code: string) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [err, setErr] = useState<string | null>(null);
  const cb = useRef(onCode);
  cb.current = onCode;

  useEffect(() => {
    let stream: MediaStream | null = null;
    let raf = 0;
    let done = false;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    (async () => {
      try {
        const jsQR = (await import("jsqr")).default;
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
        const v = video.current!;
        v.srcObject = stream;
        v.setAttribute("playsinline", "true");
        await v.play();
        const tick = () => {
          if (done) return;
          if (v.readyState >= 2 && ctx) {
            const w = Math.min(640, v.videoWidth);
            const h = Math.round((v.videoHeight / v.videoWidth) * w);
            canvas.width = w;
            canvas.height = h;
            ctx.drawImage(v, 0, 0, w, h);
            const img = ctx.getImageData(0, 0, w, h);
            const r = jsQR(img.data, w, h, { inversionAttempts: "dontInvert" });
            if (r?.data?.startsWith("MBQR:")) {
              done = true;
              cb.current(r.data);
              return;
            }
          }
          raf = requestAnimationFrame(tick);
        };
        tick();
      } catch (e) {
        setErr((e as Error).name === "NotAllowedError" ? "Kamera izni verilmedi. Telefon ayarlarından tarayıcıya kamera izni verin." : "Kamera açılamadı.");
      }
    })();
    return () => {
      done = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col" role="dialog" aria-modal="true" aria-label="QR kod okut">
      <video ref={video} className="flex-1 w-full object-cover" muted playsInline />
      <div className="absolute inset-0 grid place-items-center pointer-events-none">
        <div className="w-64 h-64 border-4 border-accent rounded-3xl" />
      </div>
      <div className="absolute inset-x-0 bottom-0 p-5 flex flex-col gap-3 bg-gradient-to-t from-black/80" style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 20px)" }}>
        <p className="text-white text-center text-sm">{err ?? "İşyerindeki ekranda görünen QR kodu çerçeveye getirin."}</p>
        <button onClick={onClose} className="h-12 rounded-xl bg-white text-brand-800 font-semibold">Vazgeç</button>
      </div>
    </div>
  );
}
