"use client";
import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { createClient } from "@/lib/supabase/client";

type Feed = { feed: Array<{ name: string; direction: "IN" | "OUT"; at: string; source: string }>; in: number; out: number; inside: number };

/** Tablet / ekran için kiosk: saatlik QR, canlı okutma akışı, bugünkü sayılar, tam ekran ve ekran açık kalma */
export function KioskQr({ branchId }: { branchId: string }) {
  const [img, setImg] = useState<string | null>(null);
  const [branch, setBranch] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [now, setNow] = useState(new Date());
  const [feed, setFeed] = useState<Feed | null>(null);
  const [full, setFull] = useState(false);
  const lastKey = useRef("");
  const [flash, setFlash] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    let alive = true;
    const loadQr = async () => {
      const { data, error } = await supabase.rpc("kiosk_qr", { p_branch: branchId });
      if (!alive) return;
      if (error) return setErr(error.message);
      const d = data as { token: string; branch: string };
      setBranch(d.branch);
      setImg(await QRCode.toDataURL(d.token, { width: 640, margin: 1, color: { dark: "#072A50", light: "#FFFFFF" } }));
      setErr(null);
    };
    const loadFeed = async () => {
      const { data } = await supabase.rpc("kiosk_feed", { p_branch: branchId });
      if (!alive || !data) return;
      const f = data as Feed;
      const key = f.feed[0] ? `${f.feed[0].name}|${f.feed[0].at}|${f.feed[0].direction}` : "";
      if (lastKey.current && key && key !== lastKey.current) {
        setFlash(`${f.feed[0]!.name} · ${f.feed[0]!.direction === "IN" ? "Giriş" : "Çıkış"} · ${f.feed[0]!.at}`);
        setTimeout(() => setFlash(null), 6000);
      }
      lastKey.current = key;
      setFeed(f);
    };
    loadQr(); loadFeed();
    const q = setInterval(loadQr, 60_000);
    const fd = setInterval(loadFeed, 8_000);
    const c = setInterval(() => setNow(new Date()), 1000);
    // Ekran kapanmasın
    let lock: { release: () => Promise<void> } | null = null;
    const wake = async () => { try { lock = await (navigator as unknown as { wakeLock?: { request: (t: string) => Promise<{ release: () => Promise<void> }> } }).wakeLock?.request("screen") ?? null; } catch { /* desteklenmiyor */ } };
    wake();
    const onVis = () => { if (document.visibilityState === "visible") { wake(); loadQr(); loadFeed(); } };
    document.addEventListener("visibilitychange", onVis);
    const onFs = () => setFull(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFs);
    return () => { alive = false; clearInterval(q); clearInterval(fd); clearInterval(c); document.removeEventListener("visibilitychange", onVis); document.removeEventListener("fullscreenchange", onFs); lock?.release().catch(() => {}); };
  }, [branchId]);

  const toggleFull = () => { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen?.(); };

  return (
    <main className="min-h-screen bg-[#072A50] text-white flex flex-col lg:flex-row items-center justify-center gap-8 p-6 relative">
      <button onClick={toggleFull} className="absolute top-3 right-3 h-10 px-3 rounded-lg bg-white/10 text-sm font-semibold">{full ? "Tam ekrandan çık" : "Tam ekran"}</button>
      <div className="flex flex-col items-center gap-5">
        <div className="flex items-center gap-3">
          <div className="w-14 h-14 rounded-xl bg-white grid place-items-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.svg" alt="" className="w-11 h-11 object-contain" />
          </div>
          <div>
            <div className="font-display font-bold text-2xl">MB DENTAL</div>
            <div className="text-[#A9BCD1]">{branch || "…"} · giriş / çıkış</div>
          </div>
        </div>
        <div className="bg-white rounded-3xl p-5 shadow-2xl">
          {img ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={img} alt="Giriş çıkış QR kodu" className="w-[min(60vw,520px)] h-[min(60vw,520px)]" />
          ) : (
            <div className="w-[min(60vw,520px)] h-[min(60vw,520px)] grid place-items-center text-[#5A6878]">{err ?? "Yükleniyor…"}</div>
          )}
        </div>
        <div className="text-center">
          <div className="font-display text-5xl font-bold tabular-nums">{now.toLocaleTimeString("tr-TR", { timeZone: "Europe/Istanbul" })}</div>
          <div className="text-[#A9BCD1] mt-1">{now.toLocaleDateString("tr-TR", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Istanbul" })}</div>
          <div className="text-[#A9BCD1] mt-1 text-sm">Uygulamada &quot;Giriş / Çıkış&quot;ı seçip &quot;QR okut&quot;a basın. Kod her saat yenilenir.</div>
        </div>
      </div>

      <aside className="w-full max-w-md flex flex-col gap-4">
        {flash && <div role="status" className="rounded-2xl bg-[#1FA971] text-white p-4 text-xl font-bold text-center animate-pulse">✓ {flash}</div>}
        <div className="grid grid-cols-3 gap-3 text-center">
          {[["İçeride", feed?.inside ?? "—"], ["Giriş", feed?.in ?? "—"], ["Çıkış", feed?.out ?? "—"]].map(([l, v]) => (
            <div key={String(l)} className="rounded-2xl bg-white/10 p-3"><div className="text-xs text-[#A9BCD1] uppercase tracking-wide">{l}</div><div className="font-display text-3xl font-bold tabular-nums">{v}</div></div>
          ))}
        </div>
        <div className="rounded-2xl bg-white/10 p-4">
          <div className="text-xs text-[#A9BCD1] uppercase tracking-wide mb-2">Son okutmalar</div>
          <ul className="flex flex-col gap-1.5">
            {(feed?.feed ?? []).map((f, i) => (
              <li key={i} className="flex justify-between items-center text-lg">
                <span className="truncate">{f.name}</span>
                <span className={`ml-3 px-2 py-0.5 rounded-md text-sm font-bold ${f.direction === "IN" ? "bg-[#1FA971]" : "bg-[#B42318]"}`}>{f.direction === "IN" ? "Giriş" : "Çıkış"} {f.at}</span>
              </li>
            ))}
            {feed && feed.feed.length === 0 && <li className="text-[#A9BCD1]">Bugün henüz okutma yok.</li>}
          </ul>
        </div>
      </aside>
    </main>
  );
}
