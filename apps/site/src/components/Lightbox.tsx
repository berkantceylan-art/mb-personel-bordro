"use client";

import { useEffect, useRef, useState } from "react";

/** Küçük resimler + tıklayınca tam ekran galeri (klavye ile gezinme) */
export function Lightbox({ images, alt, labels }: { images: string[]; alt: string; labels: { close: string; prev: string; next: string; open: string } }) {
  const [i, setI] = useState<number | null>(null);
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (i === null) return;
    if (!ref.current?.open) ref.current?.showModal();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") setI((x) => (x === null ? x : (x + 1) % images.length));
      if (e.key === "ArrowLeft") setI((x) => (x === null ? x : (x - 1 + images.length) % images.length));
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [i, images.length]);

  if (!images.length) return null;
  return (
    <>
      <ul className="mt-4 grid grid-cols-4 gap-2">
        {images.slice(0, 8).map((src, k) => (
          <li key={src}>
            <button type="button" onClick={() => setI(k)} aria-label={`${labels.open} ${k + 1}`} className="block aspect-square w-full overflow-hidden rounded-xl bg-gypsum ring-offset-2 hover:ring-2 hover:ring-smile">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={src} alt="" loading="lazy" className="h-full w-full object-cover transition-transform duration-300 hover:scale-105" />
            </button>
          </li>
        ))}
      </ul>
      {i !== null && (
        <dialog ref={ref} onClose={() => setI(null)} aria-label={alt} className="m-auto max-h-[92dvh] w-[min(72rem,94vw)] bg-transparent p-0 backdrop:bg-ink/85">
          <div className="relative">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={images[i]} alt={`${alt} ${i + 1}`} className="mx-auto max-h-[86dvh] w-auto rounded-2xl object-contain" />
            <p className="mt-2 text-center text-sm text-white/80">
              {i + 1} / {images.length}
            </p>
            <button type="button" onClick={() => ref.current?.close()} aria-label={labels.close} className="absolute right-2 top-2 grid h-11 w-11 place-items-center rounded-full bg-white/90 text-2xl text-navy hover:bg-white">
              ×
            </button>
            {images.length > 1 && (
              <>
                <button type="button" onClick={() => setI((i - 1 + images.length) % images.length)} aria-label={labels.prev} className="absolute left-2 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-white/90 text-navy hover:bg-white">
                  ‹
                </button>
                <button type="button" onClick={() => setI((i + 1) % images.length)} aria-label={labels.next} className="absolute right-2 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-white/90 text-navy hover:bg-white">
                  ›
                </button>
              </>
            )}
          </div>
        </dialog>
      )}
    </>
  );
}
