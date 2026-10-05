"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

type L = { href: string; label: string; on?: boolean };

/** Dar ekranlarda açılır menü (xl altı) */
export function MobileMenu({ links, extra, labels }: { links: L[]; extra: L[]; labels: { menu: string; close: string } }) {
  const [open, setOpen] = useState(false);
  const path = usePathname();
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={labels.menu}
        aria-expanded={open}
        className="grid h-10 w-10 place-items-center rounded-full border border-white/25 hover:border-white xl:hidden"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <path d="M4 7h16M4 12h16M4 17h10" />
        </svg>
      </button>
      <dialog
        ref={ref}
        onClose={() => setOpen(false)}
        onClick={(e) => {
          if (e.target === ref.current) setOpen(false);
        }}
        aria-label={labels.menu}
        className="mobile-menu fixed inset-y-0 right-0 m-0 ml-auto h-dvh max-h-dvh w-[min(22rem,88vw)] bg-navy p-0 text-white backdrop:bg-ink/60"
      >
        <div className="flex h-full flex-col">
          <div className="flex justify-end p-4">
            <button type="button" onClick={() => setOpen(false)} aria-label={labels.close} className="grid h-10 w-10 place-items-center rounded-full text-2xl text-white/80 hover:bg-white/10 hover:text-white">
              ×
            </button>
          </div>
          <nav aria-label={labels.menu} className="flex-1 overflow-y-auto px-6">
            <ul className="grid gap-1">
              {links.map((l) => (
                <li key={l.href}>
                  <Link
                    href={l.href}
                    onClick={() => setOpen(false)}
                    aria-current={l.on ? "page" : undefined}
                    className="display block rounded-xl px-3 py-3 text-2xl font-semibold text-white/85 hover:bg-white/10 hover:text-white aria-[current=page]:text-smile"
                  >
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          <ul className="grid gap-2 border-t border-white/10 p-6">
            {extra.map((l, i) => (
              <li key={l.href}>
                <Link
                  href={l.href}
                  onClick={() => setOpen(false)}
                  className={`block rounded-full px-5 py-3 text-center font-semibold ${i === 0 ? "bg-smile text-navy hover:bg-white" : "border border-white/25 hover:border-white"}`}
                >
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </dialog>
    </>
  );
}
