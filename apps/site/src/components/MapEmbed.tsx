"use client";

import { useState } from "react";
import type { Locale } from "@/lib/i18n";

const COPY: Record<Locale, { show: string; note: string; title: string; directions: string }> = {
  tr: { show: "Haritayı göster", note: "Harita Google tarafından yüklenir; tıkladığınızda Google'a bağlanılır.", title: "MB Dental konumu", directions: "Yol tarifi al" },
  en: { show: "Show map", note: "The map is loaded from Google; clicking connects to Google.", title: "MB Dental location", directions: "Get directions" },
  fr: { show: "Afficher la carte", note: "La carte est chargée depuis Google ; cliquer établit une connexion avec Google.", title: "Emplacement de MB Dental", directions: "Itinéraire" },
};

/** Gizlilik dostu Google Harita: tıklanınca yüklenir (önceden çerez / istek yok) */
export function MapEmbed({ src, directions, locale }: { src: string; directions: string | null; locale: Locale }) {
  const [on, setOn] = useState(false);
  const c = COPY[locale];
  return (
    <div className="overflow-hidden rounded-3xl border border-gypsum bg-white">
      <div className="relative aspect-[4/3] w-full bg-gypsum sm:aspect-[21/8]">
        {on ? (
          <iframe src={src} title={c.title} className="absolute inset-0 h-full w-full border-0" loading="lazy" referrerPolicy="no-referrer-when-downgrade" allowFullScreen />
        ) : (
          <div className="map-placeholder absolute inset-0 grid place-items-center p-6 text-center">
            <div>
              <span aria-hidden="true" className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-navy text-white shadow-lg shadow-navy/30">
                <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 21s-7-6.2-7-12a7 7 0 1 1 14 0c0 5.8-7 12-7 12z" />
                  <circle cx="12" cy="9" r="2.5" />
                </svg>
              </span>
              <button type="button" onClick={() => setOn(true)} className="mt-4 rounded-full bg-white px-5 py-2.5 font-semibold text-navy shadow ring-1 ring-navy/10 hover:bg-porcelain">
                {c.show}
              </button>
              <p className="mx-auto mt-3 max-w-xs text-xs text-slate">{c.note}</p>
            </div>
          </div>
        )}
      </div>
      {directions && (
        <div className="flex justify-end border-t border-gypsum px-5 py-3">
          <a href={directions} target="_blank" rel="noreferrer" className="text-sm font-semibold text-smile-ink hover:underline">
            {c.directions} ↗
          </a>
        </div>
      )}
    </div>
  );
}
