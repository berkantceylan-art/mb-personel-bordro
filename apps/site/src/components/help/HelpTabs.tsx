"use client";

import { useEffect, useState } from "react";
import { GuidePlayer } from "./GuidePlayer";
import { HELP_AUDIENCES, type HelpAudience, type HelpUI } from "@/lib/help-content";

const HASH: Record<HelpAudience, string> = { doctor_tr: "hekim", doctor_foreign: "yurtdisi", clinic: "klinik", agency: "araci" };
const ICON: Record<HelpAudience, string> = { doctor_tr: "🩺", doctor_foreign: "🌍", clinic: "🏥", agency: "🤝" };

export type HelpVideoView = { id: string; title: string; description: string; types: string[]; src: string | null; embed: string | null; poster: string | null };

/** Hesap türü seçimi + o türe ait adımlar, özellikler, animasyonlu anlatım, videolar ve SSS */
export function HelpTabs({ ui, videos, signupHref }: { ui: HelpUI; videos: HelpVideoView[]; signupHref: string }) {
  const [aud, setAud] = useState<HelpAudience>("doctor_tr");
  useEffect(() => {
    const fromHash = () => {
      const h = window.location.hash.replace("#", "");
      const k = (Object.keys(HASH) as HelpAudience[]).find((a) => HASH[a] === h);
      if (k) setAud(k);
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
  }, []);
  const pick = (a: HelpAudience) => {
    setAud(a);
    history.replaceState(null, "", `#${HASH[a]}`);
  };
  const x = ui.types[aud];
  const vids = videos.filter((v) => !v.types.length || v.types.includes(aud));

  return (
    <>
      <div role="tablist" aria-label={ui.choose} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {HELP_AUDIENCES.map((a) => (
          <button key={a} role="tab" type="button" aria-selected={a === aud} onClick={() => pick(a)}
            className={`flex items-center gap-3 rounded-2xl border p-4 text-left transition ${a === aud ? "border-navy bg-navy text-white shadow-lg" : "border-gypsum bg-white text-navy hover:border-navy"}`}>
            <span className="text-2xl" aria-hidden>{ICON[a]}</span>
            <span>
              <span className="block font-semibold">{ui.types[a].label}</span>
              <span className={`block text-xs ${a === aud ? "text-white/70" : "text-slate"}`}>{ui.types[a].short}</span>
            </span>
          </button>
        ))}
      </div>

      <div role="tabpanel" className="mt-10 grid gap-12">
        <p className="rounded-2xl bg-porcelain px-5 py-4 text-ink">{x.who}</p>

        {/* Hesap açma adımları */}
        <section aria-labelledby="adimlar">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <h2 id="adimlar" className="display text-2xl font-semibold text-navy sm:text-3xl">{ui.stepsTitle}</h2>
            <a href={`${signupHref}&tip=${aud}`} className="rounded-full bg-smile px-6 py-3 font-semibold text-navy hover:bg-navy hover:text-white">{ui.openAccount} →</a>
          </div>
          <ol className="mt-6 grid gap-3 md:grid-cols-5">
            {x.steps.map((s, k) => (
              <li key={k} className="relative rounded-2xl border border-gypsum bg-white p-5">
                <span className="num grid h-9 w-9 place-items-center rounded-full bg-navy font-bold text-white">{k + 1}</span>
                <p className="mt-3 text-sm text-ink">{s}</p>
              </li>
            ))}
          </ol>
        </section>

        {/* Animasyonlu anlatım */}
        <section aria-labelledby="anlatim">
          <h2 id="anlatim" className="display text-2xl font-semibold text-navy sm:text-3xl">{ui.guideTitle}</h2>
          <p className="mt-1 text-slate">{ui.guideLead}</p>
          <div className="mt-6">
            <GuidePlayer key={aud} steps={x.guide} mock={ui.mock} labels={{ play: ui.play, pause: ui.pause, prev: ui.prev, next: ui.next }} />
          </div>
        </section>

        {/* Videolar (ERP › Site içerikleri'nden eklenir) */}
        {vids.length > 0 && (
          <section aria-labelledby="videolar">
            <h2 id="videolar" className="display text-2xl font-semibold text-navy sm:text-3xl">{ui.videosTitle}</h2>
            <p className="mt-1 text-slate">{ui.videosLead}</p>
            <ul className="mt-6 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
              {vids.map((v) => (
                <li key={v.id} className="overflow-hidden rounded-2xl border border-gypsum bg-white">
                  <div className="aspect-video bg-navy">
                    {v.embed ? (
                      <iframe src={v.embed} title={v.title} className="h-full w-full" loading="lazy" allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen" allowFullScreen />
                    ) : v.src ? (
                      <video src={v.src} poster={v.poster ?? undefined} controls preload="metadata" playsInline className="h-full w-full bg-black object-contain" />
                    ) : null}
                  </div>
                  <div className="p-4">
                    <h3 className="font-semibold text-navy">{v.title}</h3>
                    {v.description && <p className="mt-1 text-sm text-slate">{v.description}</p>}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Özellikler */}
        <section aria-labelledby="ozellikler">
          <h2 id="ozellikler" className="display text-2xl font-semibold text-navy sm:text-3xl">{ui.featuresTitle}</h2>
          <ul className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {x.features.map((f) => (
              <li key={f.t} className="rounded-2xl border border-gypsum bg-white p-5">
                <span className="text-2xl" aria-hidden>{f.icon}</span>
                <h3 className="mt-2 font-semibold text-navy">{f.t}</h3>
                <p className="mt-1 text-sm text-slate">{f.d}</p>
              </li>
            ))}
          </ul>
        </section>

        {/* SSS */}
        <section aria-labelledby="sss">
          <h2 id="sss" className="display text-2xl font-semibold text-navy sm:text-3xl">{ui.faqTitle}</h2>
          <div className="mt-6 grid gap-2">
            {x.faq.map((f) => (
              <details key={f.q} className="group rounded-2xl border border-gypsum bg-white px-5 py-4 open:ring-2 open:ring-smile">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 font-semibold text-navy">
                  {f.q}<span className="text-xl text-slate transition group-open:rotate-45">+</span>
                </summary>
                <p className="mt-2 text-ink">{f.a}</p>
              </details>
            ))}
          </div>
        </section>
      </div>
    </>
  );
}
