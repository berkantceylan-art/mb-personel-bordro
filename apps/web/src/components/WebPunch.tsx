"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/** Tarayıcı konumuyla giriş/çıkış (telefon tarayıcısından da çalışır) */
export function WebPunch() {
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  function punch() {
    if (!navigator.geolocation) return setMsg({ ok: false, text: "Tarayıcınız konum desteklemiyor." });
    setBusy(true);
    setMsg(null);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { data, error } = await createClient().rpc("mobile_punch", {
          p_lat: pos.coords.latitude,
          p_lng: pos.coords.longitude,
          p_accuracy: pos.coords.accuracy,
          p_qr: null,
        });
        setBusy(false);
        if (error) return setMsg({ ok: false, text: error.message });
        const d = data as { direction: string; at: string; branch: string };
        setMsg({ ok: true, text: `${d.direction === "IN" ? "Giriş" : "Çıkış"} kaydedildi · ${d.at.slice(11, 16)} · ${d.branch}` });
        router.refresh();
      },
      (e) => {
        setBusy(false);
        setMsg({ ok: false, text: e.code === 1 ? "Konum izni verilmedi." : "Konum alınamadı, tekrar deneyin." });
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button onClick={punch} disabled={busy} className="h-12 px-6 rounded-[12px] bg-accent text-white font-bold text-base disabled:opacity-60">
        {busy ? "Konum alınıyor…" : "Giriş / çıkış yap"}
      </button>
      {msg && <span role="status" className={`text-sm rounded-lg px-3 py-1.5 ${msg.ok ? "bg-ok-bg text-ok" : "bg-bad-bg text-bad"}`}>{msg.text}</span>}
    </div>
  );
}
