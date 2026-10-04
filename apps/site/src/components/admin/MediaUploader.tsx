"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { checkFile, uploadMedia } from "@/lib/upload-client";

type Row = { name: string; state: "bekliyor" | "yükleniyor" | "tamam" | "hata"; note?: string };

/** Kütüphaneye toplu yükleme: sürükle-bırak ya da dosya seç; dosyalar sırayla yüklenir */
export function MediaUploader() {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);

  async function start(files: File[]) {
    if (busy || files.length === 0) return;
    setBusy(true);
    const list: Row[] = files.map((f) => {
      const problem = checkFile(f);
      return problem ? { name: f.name, state: "hata", note: problem } : { name: f.name, state: "bekliyor" };
    });
    setRows(list);
    for (let i = 0; i < files.length; i++) {
      if (list[i].state === "hata") continue;
      setRows((r) => r.map((x, j) => (j === i ? { ...x, state: "yükleniyor" } : x)));
      try {
        await uploadMedia(files[i], "medya");
        setRows((r) => r.map((x, j) => (j === i ? { ...x, state: "tamam" } : x)));
      } catch (e) {
        setRows((r) => r.map((x, j) => (j === i ? { ...x, state: "hata", note: (e as Error).message } : x)));
      }
    }
    setBusy(false);
    if (input.current) input.current.value = "";
    router.refresh();
  }

  const done = rows.filter((r) => r.state === "tamam").length;
  const failed = rows.filter((r) => r.state === "hata").length;

  return (
    <div className="mb-8">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          start(Array.from(e.dataTransfer.files));
        }}
        className={`rounded-2xl border-2 border-dashed p-8 text-center transition-colors ${over ? "border-navy bg-porcelain" : "border-gypsum bg-white"}`}
      >
        <p className="display text-lg font-semibold text-navy">Dosyaları buraya sürükleyin</p>
        <p className="mt-1 text-sm text-slate">ya da</p>
        <label className={`mt-3 inline-block cursor-pointer rounded-full bg-navy px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue ${busy ? "pointer-events-none opacity-60" : ""}`}>
          Dosya seç
          <input
            ref={input}
            type="file"
            multiple
            accept="image/*,video/mp4,video/webm,video/quicktime,.mov"
            className="sr-only"
            disabled={busy}
            onChange={(e) => start(Array.from(e.target.files ?? []))}
          />
        </label>
        <p className="mt-3 text-xs text-slate">Görsel (JPG, PNG, WebP, AVIF, GIF, SVG) ve video (MP4, WebM, MOV). Dosya başına en fazla 50 MB. Birden fazla seçebilirsiniz.</p>
      </div>

      {rows.length > 0 && (
        <div className="mt-4 rounded-2xl border border-gypsum bg-white p-4" aria-live="polite">
          <p className="text-sm font-semibold text-navy">
            {busy ? `Yükleniyor… ${done}/${rows.length}` : `Bitti: ${done} dosya yüklendi${failed ? `, ${failed} dosya yüklenemedi` : ""}.`}
          </p>
          <ul className="mt-3 max-h-60 divide-y divide-gypsum overflow-y-auto text-sm">
            {rows.map((r, i) => (
              <li key={i} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="min-w-0 truncate">{r.name}</span>
                <span
                  className={`text-xs font-semibold ${r.state === "tamam" ? "text-ok" : r.state === "hata" ? "text-bad" : r.state === "yükleniyor" ? "text-navy" : "text-slate"}`}
                >
                  {r.state === "hata" ? r.note : r.state}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
