"use client";
import { useEffect, useRef, useState } from "react";

type Ann = { id: string; title: string; body: string };

/** Türkçe sesle okuma (tarayıcının konuşma sentezi) */
export function speakTr(text: string, rate = 1): Promise<void> {
  return new Promise((resolve) => {
    try {
      const synth = window.speechSynthesis;
      if (!synth) return resolve();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = "tr-TR";
      u.rate = rate;
      const v = synth.getVoices().find((x) => x.lang?.toLowerCase().startsWith("tr"));
      if (v) u.voice = v;
      u.onend = () => resolve();
      u.onerror = () => resolve();
      synth.speak(u);
    } catch { resolve(); }
  });
}

export function fillTemplate(t: string, v: { name: string; company: string }) {
  const h = Number(new Date().toLocaleString("en-GB", { timeZone: "Europe/Istanbul", hour: "2-digit", hour12: false }));
  const selam = h < 11 ? "Günaydın" : h < 18 ? "İyi günler" : "İyi akşamlar";
  return t.replace(/\{ad\}/g, v.name).replace(/\{isim\}/g, v.name.split(" ")[0] ?? v.name).replace(/\{selam\}/g, selam).replace(/\{sirket\}/g, v.company);
}

/**
 * Sesli karşılama ve sesli duyuru: tarayıcılar sayfa açılınca kendiliğinden ses çalmaya izin vermediği için
 * girişten sonraki ilk dokunuş / tuşta konuşur. Karşılama günde bir kez; sesli duyurular her kişiye bir kez.
 */
export function VoiceGreeter({ userId, name, company, template, enabled, rate, announcements }: { userId: string; name: string; company: string; template: string; enabled: boolean; rate: number; announcements: Ann[] }) {
  const [toast, setToast] = useState<string | null>(null);
  const done = useRef(false);
  useEffect(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    let muted = false;
    try { muted = localStorage.getItem("voice-mute") === "1"; } catch { /* yok */ }
    if (muted) return;
    const day = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Istanbul" });
    let greeted = true, heard: string[] = [];
    try { greeted = localStorage.getItem("voice-greeted") === `${userId}:${day}`; heard = JSON.parse(localStorage.getItem("voice-heard") ?? "[]") as string[]; } catch { /* yok */ }
    const pending = announcements.filter((a) => !heard.includes(a.id)).slice(0, 3);
    if ((!enabled || greeted) && !pending.length) return;
    window.speechSynthesis.getVoices();
    const run = async () => {
      if (done.current) return;
      done.current = true;
      off();
      if (enabled && !greeted) {
        const text = fillTemplate(template, { name, company });
        setToast(text);
        try { localStorage.setItem("voice-greeted", `${userId}:${day}`); } catch { /* yok */ }
        await speakTr(text, rate);
      }
      for (const a of pending) {
        setToast(`📢 ${a.title}`);
        await speakTr(`Duyuru. ${a.title}. ${a.body.slice(0, 400)}`, rate);
        heard = [...heard, a.id].slice(-200);
        try { localStorage.setItem("voice-heard", JSON.stringify(heard)); } catch { /* yok */ }
      }
      setTimeout(() => setToast(null), 2500);
    };
    const handler = () => void run();
    const off = () => { window.removeEventListener("pointerdown", handler); window.removeEventListener("keydown", handler); };
    window.addEventListener("pointerdown", handler, { once: true });
    window.addEventListener("keydown", handler, { once: true });
    return off;
  }, [userId, name, company, template, enabled, rate, announcements]);
  if (!toast) return null;
  return (
    <div className="fixed left-1/2 top-3 z-[90] flex max-w-[92vw] -translate-x-1/2 items-center gap-3 rounded-full bg-[#0F2A47] px-4 py-2 text-sm text-white shadow-xl print:hidden" role="status">
      <span>🔊</span><span className="truncate">{toast}</span>
      <button type="button" onClick={() => { try { localStorage.setItem("voice-mute", "1"); } catch { /* yok */ } window.speechSynthesis?.cancel(); setToast(null); }} className="rounded-full bg-white/15 px-2 py-0.5 text-xs">Sesi kapat</button>
    </div>
  );
}
