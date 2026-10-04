"use client";

import { useRef, useState } from "react";
import { LOCALES, LOCALE_NAMES, type I18nText } from "@/lib/i18n";
import { mediaKind, mediaName, publicMediaUrl } from "@/lib/media";
import { uploadMedia } from "@/lib/upload-client";
import { MediaPicker } from "./MediaField";

type Frame = { path: string; caption?: I18nText };

const small = "grid h-8 w-8 place-items-center rounded-full border border-gypsum bg-white text-slate hover:border-navy hover:text-navy disabled:opacity-30";

/**
 * Hikâye kareleri: bilgisayardan yükle ya da kütüphaneden seç, sırala, altyazı yaz.
 * Sonuç "frames" gizli alanında JSON olarak gönderilir.
 */
export function StoryFramesEditor({ initial }: { initial: Frame[] }) {
  const [frames, setFrames] = useState<Frame[]>(initial);
  const [picker, setPicker] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const move = (i: number, d: -1 | 1) =>
    setFrames((f) => {
      const n = [...f];
      [n[i], n[i + d]] = [n[i + d], n[i]];
      return n;
    });
  const setCaption = (i: number, l: string, v: string) =>
    setFrames((f) => f.map((x, j) => (j === i ? { ...x, caption: { ...x.caption, [l]: v } } : x)));

  async function upload(files: File[]) {
    setError(null);
    for (const file of files) {
      setBusy(file.name);
      try {
        const { path } = await uploadMedia(file, "medya");
        setFrames((f) => [...f, { path, caption: {} }]);
      } catch (e) {
        setError((e as Error).message);
        break;
      }
    }
    setBusy(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  return (
    <fieldset className="rounded-xl border border-gypsum bg-white p-4">
      <legend className="px-1 text-sm font-semibold text-navy">
        Kareler <span className="text-bad">*</span>
      </legend>
      <p className="mb-4 text-xs text-slate">
        Sırayla oynatılır. Görseller 5 saniye, videolar kendi süresi kadar görünür. Dikey (9:16) çekimler en iyi sonucu verir. En fazla 30 kare.
      </p>
      <input type="hidden" name="frames" value={JSON.stringify(frames)} />

      {frames.length > 0 && (
        <ol className="mb-4 grid gap-3">
          {frames.map((f, i) => {
            const url = publicMediaUrl(f.path);
            return (
              <li key={`${f.path}-${i}`} className="grid gap-3 rounded-xl border border-gypsum p-3 sm:grid-cols-[auto_5.5rem_1fr_auto] sm:items-start">
                <span className="display num text-xl font-semibold text-smile-ink sm:pt-1">{i + 1}</span>
                <div className="aspect-[9/16] w-[5.5rem] overflow-hidden rounded-lg bg-ink">
                  {mediaKind(null, f.path) === "video" ? (
                    <video src={`${url}#t=0.5`} muted preload="metadata" className="h-full w-full object-cover" />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={url} alt="" className="h-full w-full object-cover" />
                  )}
                </div>
                <div className="grid min-w-0 gap-2">
                  <p className="truncate text-xs text-slate">
                    {mediaKind(null, f.path) === "video" ? "Video · " : "Görsel · "}
                    {mediaName(f.path)}
                  </p>
                  {LOCALES.map((l) => (
                    <label key={l} className="grid gap-1 text-xs text-slate sm:grid-cols-[5rem_1fr] sm:items-center sm:gap-2">
                      <span>Altyazı {LOCALE_NAMES[l].slice(0, 2).toUpperCase()}</span>
                      <input value={f.caption?.[l] ?? ""} onChange={(e) => setCaption(i, l, e.target.value)} maxLength={300} lang={l} className="field" />
                    </label>
                  ))}
                </div>
                <div className="flex gap-1 sm:flex-col">
                  <button type="button" className={small} onClick={() => move(i, -1)} disabled={i === 0} aria-label={`${i + 1}. kareyi yukarı taşı`}>
                    ▲
                  </button>
                  <button type="button" className={small} onClick={() => move(i, 1)} disabled={i === frames.length - 1} aria-label={`${i + 1}. kareyi aşağı taşı`}>
                    ▼
                  </button>
                  <button
                    type="button"
                    className={`${small} hover:border-bad hover:text-bad`}
                    onClick={() => setFrames((x) => x.filter((_, j) => j !== i))}
                    aria-label={`${i + 1}. kareyi çıkar`}
                  >
                    ×
                  </button>
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {error && (
        <p role="alert" className="mb-3 rounded-lg bg-bad-bg px-3 py-2 text-sm text-bad">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <label className={`cursor-pointer rounded-full bg-navy px-4 py-2 text-sm font-semibold text-white hover:bg-blue ${busy || frames.length >= 30 ? "pointer-events-none opacity-60" : ""}`}>
          {busy ? "Yükleniyor…" : "Bilgisayardan ekle"}
          <input
            ref={fileRef}
            type="file"
            multiple
            accept="image/*,video/mp4,video/webm,video/quicktime,.mov"
            className="sr-only"
            disabled={!!busy || frames.length >= 30}
            onChange={(e) => upload(Array.from(e.target.files ?? []).slice(0, 30 - frames.length))}
          />
        </label>
        <button
          type="button"
          onClick={() => setPicker(true)}
          disabled={!!busy || frames.length >= 30}
          className="rounded-full border border-gypsum bg-white px-4 py-2 text-sm font-semibold text-navy hover:border-navy disabled:opacity-50"
        >
          Kütüphaneden seç
        </button>
        {busy && <span className="truncate text-sm text-slate">{busy}</span>}
        {frames.length === 0 && !busy && <span className="text-sm text-slate">Henüz kare yok.</span>}
      </div>

      {picker && (
        <MediaPicker
          kind="all"
          multiple
          initial={[]}
          onClose={() => setPicker(false)}
          onPick={(paths) => {
            setFrames((f) => [...f, ...paths.map((path) => ({ path, caption: {} }))].slice(0, 30));
            setPicker(false);
          }}
        />
      )}
    </fieldset>
  );
}
