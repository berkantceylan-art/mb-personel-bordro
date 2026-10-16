"use client";
import { useEffect, useRef, useState } from "react";
import { logCamView } from "@/lib/camera-actions";

type Cam = { id: string; name: string; group_name: string; embed_url: string };

/** Duvar düzeni: kamera sayısına göre ekranı dolduran sütun / satır (30 kamera → 6×5) */
function wallShape(n: number) {
  if (n <= 1) return { cols: 1, rows: 1 };
  const c = Math.ceil(Math.sqrt(n));
  return { cols: c, rows: Math.ceil(n / c) };
}

const LAYOUTS = [1, 2, 3, 4, 5, 6];

/** go2rtc'de her kanalın sesli kopyası "<kanal>_ses" adıyla tanımlı; varsayılan akışlar sessizdir */
function withSound(url: string) {
  const m = url.match(/([?&]src=)([^&#]+)/);
  if (!m || m[2].endsWith("_ses")) return null;
  return url.replace(m[0], `${m[1]}${m[2]}_ses`);
}

/** Kamera ızgarası: grup filtresi, 1–36'lı görünüm, tüm kameralar duvarı, tam ekran; izleme kaydı tutulur */
export function CamGrid({ cams, startWall = false }: { cams: Cam[]; startWall?: boolean }) {
  const groups = [...new Set(cams.map((c) => c.group_name))];
  const [g, setG] = useState("");
  const [cols, setCols] = useState(3);
  const [wall, setWall] = useState(startWall);
  const [full, setFull] = useState<Cam | null>(null);
  const [sound, setSound] = useState(false);
  const wallRef = useRef<HTMLDivElement>(null);
  const shown = cams.filter((c) => !g || c.group_name === g);

  useEffect(() => {
    try { const v = Number(localStorage.getItem("cam-cols")); if (v >= 1 && v <= 6) setCols(v); } catch { /* yok */ }
  }, []);
  useEffect(() => {
    if (shown.length) void logCamView(shown.map((c) => c.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [g]);
  useEffect(() => {
    if (!wall && !full) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { if (full) { setFull(null); setSound(false); } else setWall(false); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [wall, full]);

  function pickCols(n: number) {
    setCols(n);
    try { localStorage.setItem("cam-cols", String(n)); } catch { /* yok */ }
  }
  function openWall() {
    setWall(true);
    setTimeout(() => { void wallRef.current?.requestFullscreen?.().catch(() => undefined); }, 50);
  }
  function closeWall() {
    setWall(false);
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
  }

  const shape = wallShape(shown.length);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-1.5">
        {["", ...groups].map((x) => <button key={x} type="button" onClick={() => setG(x)} className={`rounded-full px-3 py-1.5 text-sm font-semibold ${g === x ? "bg-ink text-white" : "border border-line bg-white"}`}>{x || `Tümü (${cams.length})`}</button>)}
        <span className="flex-1" />
        <span className="mr-1 text-xs text-muted">Görünüm</span>
        {LAYOUTS.map((n) => <button key={n} type="button" onClick={() => pickCols(n)} title={`${n * n}'lı görünüm`} className={`h-9 min-w-9 rounded-lg px-1.5 text-sm font-bold ${cols === n ? "bg-brand-700 text-white" : "border border-line bg-white"}`}>{n * n}</button>)}
        <button type="button" onClick={openWall} className="ml-1 h-9 rounded-lg bg-ink px-3 text-sm font-semibold text-white">▦ Tüm kameralar ({shown.length})</button>
      </div>

      <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
        {shown.map((c) => (
          <div key={c.id} className="relative overflow-hidden rounded-lg bg-black">
            <iframe src={c.embed_url} title={c.name} loading="lazy" className="aspect-video w-full border-0" allow="autoplay; fullscreen" referrerPolicy="no-referrer" sandbox="allow-scripts allow-same-origin" />
            <div className="absolute inset-x-0 top-0 flex items-center gap-2 bg-gradient-to-b from-black/70 to-transparent px-2 py-1 text-xs text-white">
              <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-red-500" /><b className="flex-1 truncate">{c.name}</b>{cols <= 4 && <span className="opacity-70">{c.group_name}</span>}
              <button type="button" onClick={() => setFull(c)} className="rounded bg-white/20 px-1.5" aria-label="Büyüt">⛶</button>
            </div>
          </div>
        ))}
      </div>

      {wall && (
        <div ref={wallRef} className="fixed inset-0 z-[85] flex flex-col bg-black" role="dialog" aria-label="Tüm kameralar">
          <div className="flex items-center gap-2 px-3 py-1.5 text-sm text-white">
            <b className="flex-1">Tüm kameralar · {shown.length}{g ? ` · ${g}` : ""}</b>
            <span className="hidden text-xs opacity-60 sm:inline">Büyütmek için kameraya tıklayın · Çıkış: Esc</span>
            <button type="button" onClick={closeWall} className="rounded bg-white/20 px-3 py-1">Kapat ✕</button>
          </div>
          <div className="grid flex-1 gap-0.5 p-0.5" style={{ gridTemplateColumns: `repeat(${shape.cols}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${shape.rows}, minmax(0, 1fr))` }}>
            {shown.map((c) => (
              <div key={c.id} className="relative min-h-0 overflow-hidden bg-black">
                <iframe src={c.embed_url} title={c.name} className="pointer-events-none h-full w-full border-0" allow="autoplay" referrerPolicy="no-referrer" sandbox="allow-scripts allow-same-origin" />
                <button type="button" onClick={() => setFull(c)} className="absolute inset-0" aria-label={`${c.name} büyüt`} />
                <span className="pointer-events-none absolute left-1 top-1 max-w-[90%] truncate rounded bg-black/60 px-1.5 text-[11px] font-semibold text-white">{c.name}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {full && (
        <div className="fixed inset-0 z-[90] flex flex-col bg-black" role="dialog">
          <div className="flex items-center gap-2 px-4 py-2 text-white">
            <b className="flex-1">{full.name}</b>
            {withSound(full.embed_url) && <button type="button" onClick={() => setSound((v) => !v)} className={`rounded px-3 py-1 ${sound ? "bg-red-600" : "bg-white/20"}`}>{sound ? "🔊 Sesi kapat" : "🔇 Ses aç"}</button>}
            <button type="button" onClick={() => { setFull(null); setSound(false); }} className="rounded bg-white/20 px-3 py-1">Kapat ✕</button>
          </div>
          <iframe key={sound ? "ses" : "sessiz"} src={sound ? withSound(full.embed_url) ?? full.embed_url : full.embed_url} title={full.name} className="w-full flex-1 border-0" allow="autoplay; fullscreen" referrerPolicy="no-referrer" sandbox="allow-scripts allow-same-origin" />
        </div>
      )}
    </div>
  );
}
