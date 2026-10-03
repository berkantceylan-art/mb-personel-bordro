"use client";
import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { createClient } from "@/lib/supabase/client";

export function KioskQr({ branchId }: { branchId: string }) {
  const [img, setImg] = useState<string | null>(null);
  const [branch, setBranch] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const supabase = createClient();
    let alive = true;
    const load = async () => {
      const { data, error } = await supabase.rpc("kiosk_qr", { p_branch: branchId });
      if (!alive) return;
      if (error) return setErr(error.message);
      const d = data as { token: string; branch: string };
      setBranch(d.branch);
      setImg(await QRCode.toDataURL(d.token, { width: 520, margin: 1, color: { dark: "#072A50", light: "#FFFFFF" } }));
      setErr(null);
    };
    load();
    const q = setInterval(load, 60_000);
    const c = setInterval(() => setNow(new Date()), 1000);
    return () => { alive = false; clearInterval(q); clearInterval(c); };
  }, [branchId]);

  return (
    <main className="min-h-screen bg-[#072A50] text-white flex flex-col items-center justify-center gap-6 p-6">
      <div className="flex items-center gap-3">
        <div className="w-14 h-14 rounded-xl bg-white grid place-items-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="" className="w-11 h-10 object-contain" />
        </div>
        <div>
          <div className="font-display font-bold text-2xl">MB DENTAL</div>
          <div className="text-[#A9BCD1]">{branch || "…"} · giriş / çıkış</div>
        </div>
      </div>
      <div className="bg-white rounded-3xl p-5 shadow-2xl">
        {img ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={img} alt="Giriş çıkış QR kodu" className="w-[min(70vw,520px)] h-[min(70vw,520px)]" />
        ) : (
          <div className="w-[min(70vw,520px)] h-[min(70vw,520px)] grid place-items-center text-[#5A6878]">{err ?? "Yükleniyor…"}</div>
        )}
      </div>
      <div className="text-center">
        <div className="font-display text-5xl font-bold tabular-nums">{now.toLocaleTimeString("tr-TR", { timeZone: "Europe/Istanbul" })}</div>
        <div className="text-[#A9BCD1] mt-1">MB Personel uygulamasında &quot;QR ile okut&quot;a basıp kodu okutun. Kod her saat yenilenir.</div>
      </div>
    </main>
  );
}
