"use client";
import { useEffect, useState } from "react";
import { logCamView } from "@/lib/camera-actions";

type Cam = { id: string; name: string; group_name: string; embed_url: string };

/** Kamera ızgarası: grup filtresi, 1 / 4 / 9 görünüm, tam ekran; izleme kaydı tutulur */
export function CamGrid({ cams }: { cams: Cam[] }) {
  const groups = [...new Set(cams.map((c) => c.group_name))];
  const [g, setG] = useState("");
  const [cols, setCols] = useState(2);
  const [full, setFull] = useState<Cam | null>(null);
  const shown = cams.filter((c) => !g || c.group_name === g);
  useEffect(() => {
    if (shown.length) void logCamView(shown.map((c) => c.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [g]);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-1.5">
        {["", ...groups].map((x) => <button key={x} type="button" onClick={() => setG(x)} className={`rounded-full px-3 py-1.5 text-sm font-semibold ${g === x ? "bg-ink text-white" : "border border-line bg-white"}`}>{x || "Tümü"}</button>)}
        <span className="flex-1" />
        {[1, 2, 3].map((n) => <button key={n} type="button" onClick={() => setCols(n)} className={`h-9 w-9 rounded-lg text-sm font-bold ${cols === n ? "bg-brand-700 text-white" : "border border-line bg-white"}`}>{n * n}</button>)}
      </div>
      <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
        {shown.map((c) => (
          <div key={c.id} className="relative overflow-hidden rounded-xl bg-black">
            <iframe src={c.embed_url} title={c.name} className="aspect-video w-full border-0" allow="autoplay; fullscreen" referrerPolicy="no-referrer" sandbox="allow-scripts allow-same-origin" />
            <div className="absolute inset-x-0 top-0 flex items-center gap-2 bg-gradient-to-b from-black/70 to-transparent px-3 py-1.5 text-xs text-white">
              <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" /><b className="flex-1 truncate">{c.name}</b><span className="opacity-70">{c.group_name}</span>
              <button type="button" onClick={() => setFull(c)} className="rounded bg-white/20 px-1.5" aria-label="Büyüt">⛶</button>
            </div>
          </div>
        ))}
      </div>
      {full && (
        <div className="fixed inset-0 z-[90] flex flex-col bg-black" role="dialog">
          <div className="flex items-center gap-2 px-4 py-2 text-white"><b className="flex-1">{full.name}</b><button type="button" onClick={() => setFull(null)} className="rounded bg-white/20 px-3 py-1">Kapat ✕</button></div>
          <iframe src={full.embed_url} title={full.name} className="w-full flex-1 border-0" allow="autoplay; fullscreen" referrerPolicy="no-referrer" sandbox="allow-scripts allow-same-origin" />
        </div>
      )}
    </div>
  );
}
