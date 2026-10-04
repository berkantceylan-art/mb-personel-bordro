"use client";

import { useEffect, useRef, useState } from "react";

const KEY = "mbd-acilir-duyuru";

/** Açılır duyuru: ziyaretçiye her duyuru sürümü için bir kez gösterilir */
export function Popup({ id, version, title, body, image, link, closeLabel }: { id: string; version: string; title: string; body: string; image: string | null; link: { href: string; label: string } | null; closeLabel: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDialogElement>(null);
  const stamp = `${id}:${version}`;

  useEffect(() => {
    let seen = "";
    try {
      seen = localStorage.getItem(KEY) ?? "";
    } catch {
      /* gizli pencere */
    }
    if (seen === stamp) return;
    const timer = setTimeout(() => setOpen(true), 1200);
    return () => clearTimeout(timer);
  }, [stamp]);

  useEffect(() => {
    if (open) ref.current?.showModal();
  }, [open]);

  const close = () => {
    try {
      localStorage.setItem(KEY, stamp);
    } catch {
      /* yok say */
    }
    ref.current?.close();
    setOpen(false);
  };

  if (!open) return null;
  return (
    <dialog
      ref={ref}
      onClose={close}
      onClick={(e) => {
        if (e.target === ref.current) close();
      }}
      aria-labelledby="popup-title"
      className="m-auto w-[min(32rem,calc(100vw-2rem))] overflow-hidden rounded-3xl bg-white p-0 text-ink shadow-2xl backdrop:bg-navy/60"
    >
      {image && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={image} alt="" className="aspect-[16/9] w-full object-cover" />
      )}
      <div className="p-7">
        <h2 id="popup-title" className="display text-2xl font-semibold text-navy">
          {title}
        </h2>
        {body && <p className="mt-3 whitespace-pre-line leading-relaxed text-slate">{body}</p>}
        <div className="mt-6 flex flex-wrap gap-3">
          {link && (
            <a href={link.href} onClick={close} className="rounded-full bg-navy px-5 py-3 font-semibold text-white hover:bg-blue">
              {link.label}
            </a>
          )}
          <button type="button" onClick={close} className="rounded-full border border-gypsum px-5 py-3 font-semibold text-navy hover:border-navy">
            {closeLabel}
          </button>
        </div>
      </div>
      <button type="button" onClick={close} aria-label={closeLabel} className="absolute right-3 top-3 grid h-10 w-10 place-items-center rounded-full bg-white/90 text-xl text-navy shadow hover:bg-white">
        ×
      </button>
    </dialog>
  );
}
