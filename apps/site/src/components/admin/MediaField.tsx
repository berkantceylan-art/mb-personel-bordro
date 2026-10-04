"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { listMedia } from "@/lib/admin-actions";
import { mediaKind, mediaName, publicMediaUrl, type MediaItem } from "@/lib/media";

const fileCls = "block w-full text-sm file:mr-3 file:rounded-full file:border-0 file:bg-navy file:px-4 file:py-2 file:text-white";

/**
 * Dosya alanı: bilgisayardan yükle ya da medya kütüphanesinden seç.
 * Seçilen dosyaların yolu `<ad>__path` gizli alanıyla gönderilir; yüklenen dosyalar
 * UploadForm tarafından aynı ada eklenir.
 */
export function MediaField({
  name,
  kind,
  multiple = false,
  id,
}: {
  name: string;
  kind: "image" | "video";
  multiple?: boolean;
  id?: string;
}) {
  const [picked, setPicked] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const accept = kind === "image" ? "image/*" : "video/mp4,video/webm,video/quicktime,.mov";

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <input
          ref={fileRef}
          id={id ?? name}
          type="file"
          name={name}
          accept={accept}
          multiple={multiple}
          className={`${fileCls} w-auto max-w-full flex-1`}
          onChange={(e) => {
            if (!multiple && e.target.files?.length) setPicked([]);
          }}
        />
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded-full border border-gypsum bg-white px-4 py-2 text-sm font-semibold text-navy hover:border-navy"
        >
          Kütüphaneden seç
        </button>
      </div>

      {picked.length > 0 && (
        <ul className="flex flex-wrap gap-3">
          {picked.map((p) => (
            <li key={p} className="relative">
              <input type="hidden" name={`${name}__path`} value={p} />
              {kind === "image" ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={publicMediaUrl(p)} alt="" className="h-20 w-20 rounded-lg object-cover ring-2 ring-smile" />
              ) : (
                <video src={`${publicMediaUrl(p)}#t=0.5`} muted preload="metadata" className="h-20 w-28 rounded-lg object-cover ring-2 ring-smile" />
              )}
              <button
                type="button"
                aria-label={`${mediaName(p)} seçimini kaldır`}
                onClick={() => setPicked((x) => x.filter((y) => y !== p))}
                className="absolute -right-2 -top-2 grid h-7 w-7 place-items-center rounded-full bg-navy text-sm text-white hover:bg-bad"
              >
                ×
              </button>
            </li>
          ))}
          <li className="self-center text-xs text-slate">Kütüphaneden seçildi; kaydedince eklenir.</li>
        </ul>
      )}

      {open && (
        <MediaPicker
          kind={kind}
          multiple={multiple}
          initial={picked}
          onClose={() => setOpen(false)}
          onPick={(paths) => {
            setPicked(paths);
            if (!multiple && paths.length && fileRef.current) fileRef.current.value = "";
            setOpen(false);
          }}
        />
      )}
    </div>
  );
}

export function MediaPicker({
  kind,
  multiple,
  initial,
  onClose,
  onPick,
}: {
  kind: "image" | "video" | "all";
  multiple: boolean;
  initial: string[];
  onClose: () => void;
  onPick: (paths: string[]) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [items, setItems] = useState<MediaItem[]>([]);
  const [more, setMore] = useState(false);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<string[]>(initial);
  const [loading, start] = useTransition();

  function load(term: string, offset = 0) {
    start(async () => {
      const res = await listMedia({ q: term, kind, offset });
      setItems((prev) => (offset ? [...prev, ...res.items] : res.items));
      setMore(res.more);
    });
  }

  useEffect(() => {
    dialog.current?.showModal();
    load("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function toggle(path: string) {
    if (!multiple) return onPick([path]);
    setSel((s) => (s.includes(path) ? s.filter((x) => x !== path) : [...s, path]));
  }

  return (
    <dialog
      ref={dialog}
      onClose={onClose}
      aria-labelledby="picker-title"
      className="m-auto w-[min(56rem,calc(100vw-2rem))] rounded-2xl bg-porcelain p-0 text-ink shadow-2xl backdrop:bg-navy/50"
    >
      <div className="flex max-h-[85dvh] flex-col">
        <div className="flex flex-wrap items-center gap-3 border-b border-gypsum bg-white px-5 py-4">
          <h2 id="picker-title" className="display mr-auto text-lg font-semibold text-navy">
            {kind === "image" ? "Görsel seç" : kind === "video" ? "Video seç" : "Görsel ya da video seç"}
          </h2>
          <div role="search" className="flex gap-2">
            <label className="sr-only" htmlFor="picker-q">
              Ara
            </label>
            <input
              id="picker-q"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  load(q);
                }
              }}
              placeholder="Dosya adı ara"
              className="field w-48"
            />
            <button type="button" onClick={() => load(q)} className="rounded-full border border-gypsum px-4 text-sm font-semibold text-navy hover:border-navy">
              Ara
            </button>
          </div>
          <button type="button" onClick={() => dialog.current?.close()} aria-label="Kapat" className="grid h-9 w-9 place-items-center rounded-full text-xl text-slate hover:bg-gypsum">
            ×
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {items.length === 0 && !loading && (
            <p className="py-10 text-center text-sm text-slate">
              Kütüphanede uygun dosya yok. Bilgisayardan yükleyebilir ya da önce <a href="/admin/medya" className="font-semibold text-navy underline">Medya kütüphanesine</a> ekleyebilirsiniz.
            </p>
          )}
          <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6">
            {items.map((m) => {
              const on = sel.includes(m.path);
              const url = publicMediaUrl(m.path);
              return (
                <li key={m.id}>
                  <button
                    type="button"
                    onClick={() => toggle(m.path)}
                    aria-pressed={multiple ? on : undefined}
                    title={m.title || mediaName(m.path)}
                    className={`relative block aspect-square w-full overflow-hidden rounded-lg bg-gypsum ring-offset-2 ${on ? "ring-4 ring-smile" : "hover:ring-2 hover:ring-navy"}`}
                  >
                    {mediaKind(m.mime, m.path) === "video" ? (
                      <video src={`${url}#t=0.5`} muted preload="metadata" className="h-full w-full object-cover" />
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={url} alt={m.title ?? ""} className="h-full w-full object-cover" loading="lazy" />
                    )}
                    {on && <span className="absolute right-1 top-1 grid h-6 w-6 place-items-center rounded-full bg-smile text-xs font-bold text-navy">✓</span>}
                  </button>
                </li>
              );
            })}
          </ul>
          {loading && <p className="py-4 text-center text-sm text-slate">Yükleniyor…</p>}
          {more && !loading && (
            <div className="mt-4 text-center">
              <button type="button" onClick={() => load(q, items.length)} className="rounded-full border border-gypsum bg-white px-4 py-2 text-sm font-semibold text-navy hover:border-navy">
                Daha fazla göster
              </button>
            </div>
          )}
        </div>

        {multiple && (
          <div className="flex items-center justify-end gap-3 border-t border-gypsum bg-white px-5 py-4">
            <span className="mr-auto text-sm text-slate">{sel.length} seçili</span>
            <button type="button" onClick={() => dialog.current?.close()} className="px-3 py-2 text-sm font-semibold text-slate hover:text-navy">
              Vazgeç
            </button>
            <button type="button" onClick={() => onPick(sel)} className="rounded-full bg-navy px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue">
              Seçilenleri ekle
            </button>
          </div>
        )}
      </div>
    </dialog>
  );
}
