"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type StoryView = {
  id: string;
  version: string;
  title: string;
  cover: string | null;
  coverIsVideo: boolean;
  frames: { url: string; kind: "image" | "video"; caption: string }[];
  link: { href: string; label: string } | null;
};

type Labels = { title: string; close: string; prev: string; next: string; mute: string; unmute: string; pause: string; play: string };

const IMAGE_MS = 5000;
const SEEN_KEY = "mbd-hikaye-izlendi";

function readSeen(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(SEEN_KEY) ?? "{}") as Record<string, string>;
  } catch {
    return {};
  }
}
function writeSeen(v: Record<string, string>) {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify(v));
  } catch {
    /* gizli pencere vb. */
  }
}

export function Stories({ stories, labels }: { stories: StoryView[]; labels: Labels }) {
  const [open, setOpen] = useState<number | null>(null);
  const [seen, setSeen] = useState<Record<string, string>>({});
  useEffect(() => setSeen(readSeen()), []);

  const markSeen = useCallback((s: StoryView) => {
    setSeen((prev) => {
      if (prev[s.id] === s.version) return prev;
      const next = { ...prev, [s.id]: s.version };
      writeSeen(next);
      return next;
    });
  }, []);

  if (stories.length === 0) return null;

  return (
    <>
      <ul aria-label={labels.title} className="flex snap-x gap-4 overflow-x-auto px-1 pb-2 pt-1 sm:gap-6">
        {stories.map((s, i) => {
          const isSeen = seen[s.id] === s.version;
          return (
            <li key={s.id} className="shrink-0 snap-start">
              <button type="button" onClick={() => setOpen(i)} className="group flex w-[5.5rem] flex-col items-center gap-2 text-center sm:w-24">
                <span className={`rounded-full p-[3px] ${isSeen ? "bg-gypsum" : "bg-gradient-to-tr from-blue via-smile to-smile"}`}>
                  <span className="block rounded-full bg-white p-[3px]">
                    <span className="block h-[4.5rem] w-[4.5rem] overflow-hidden rounded-full bg-navy sm:h-20 sm:w-20">
                      {s.cover &&
                        (s.coverIsVideo ? (
                          <video src={`${s.cover}#t=0.5`} muted playsInline preload="metadata" className="h-full w-full object-cover" />
                        ) : (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={s.cover} alt="" className="h-full w-full object-cover transition-transform group-hover:scale-105" loading="lazy" />
                        ))}
                    </span>
                  </span>
                </span>
                <span className={`line-clamp-2 text-xs font-semibold leading-tight ${isSeen ? "text-slate" : "text-ink"}`}>{s.title}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {open !== null && (
        <Viewer
          stories={stories}
          start={open}
          labels={labels}
          onSeen={markSeen}
          onClose={() => setOpen(null)}
        />
      )}
    </>
  );
}

/** Sitenin köşesinde küçük hikâye penceresi: tıklayınca hikâyeler tam ekran açılır */
export function StoryBubble({ stories, labels }: { stories: StoryView[]; labels: Labels & { open: string; dismiss: string; badge: string } }) {
  const [show, setShow] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  const [seen, setSeen] = useState<Record<string, string>>({});

  useEffect(() => {
    setSeen(readSeen());
    let hidden = false;
    try {
      hidden = sessionStorage.getItem("mbd-hikaye-gizli") === "1";
    } catch {
      /* depolama kapalı */
    }
    if (hidden) return;
    const id = setTimeout(() => setShow(true), 1500);
    return () => clearTimeout(id);
  }, []);

  const markSeen = useCallback((st: StoryView) => {
    setSeen((prev) => {
      if (prev[st.id] === st.version) return prev;
      const next = { ...prev, [st.id]: st.version };
      writeSeen(next);
      return next;
    });
  }, []);

  if (!stories.length) return null;
  const firstUnseen = stories.findIndex((x) => seen[x.id] !== x.version);
  const idx = firstUnseen < 0 ? 0 : firstUnseen;
  const story = stories[idx];
  const fresh = firstUnseen >= 0;

  return (
    <>
      {show && open === null && (
        <div className="story-bubble fixed bottom-4 left-4 z-40 sm:bottom-5 sm:left-5">
          <button type="button" onClick={() => setOpen(idx)} aria-label={`${labels.open}: ${story.title}`} className="group relative block">
            <span className={`block rounded-[1.4rem] p-[3px] shadow-xl shadow-navy/30 ${fresh ? "story-ring bg-gradient-to-tr from-blue via-smile to-[#8be9ff]" : "bg-white"}`}>
              <span className="block overflow-hidden rounded-[1.2rem] bg-navy">
                <span className="relative block h-[6.5rem] w-[4.6rem] sm:h-32 sm:w-[5.6rem]">
                  {story.cover &&
                    (story.coverIsVideo ? (
                      <video src={`${story.cover}#t=0.5`} muted playsInline preload="metadata" className="h-full w-full object-cover" />
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={story.cover} alt="" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-110" />
                    ))}
                  <span className="absolute inset-0 bg-gradient-to-t from-navy/85 via-navy/10 to-transparent" />
                  <span className="absolute inset-x-1.5 bottom-1.5 line-clamp-2 text-left text-[11px] font-semibold leading-tight text-white">{story.title}</span>
                  <span aria-hidden="true" className="absolute left-1/2 top-1/2 grid h-8 w-8 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-white/85 text-navy opacity-90 transition group-hover:scale-110">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M7 4v16l13-8z" />
                    </svg>
                  </span>
                </span>
              </span>
            </span>
            {fresh && <span className="absolute -right-1.5 -top-1.5 rounded-full bg-smile px-1.5 py-0.5 text-[10px] font-bold text-navy ring-2 ring-white">{labels.badge}</span>}
          </button>
          <button
            type="button"
            onClick={() => {
              setShow(false);
              try {
                sessionStorage.setItem("mbd-hikaye-gizli", "1");
              } catch {
                /* depolama kapalı */
              }
            }}
            aria-label={labels.dismiss}
            className="absolute -left-2 -top-2 grid h-6 w-6 place-items-center rounded-full bg-white text-sm leading-none text-slate shadow ring-1 ring-navy/10 hover:text-navy"
          >
            ×
          </button>
        </div>
      )}
      {open !== null && <Viewer stories={stories} start={open} labels={labels} onSeen={markSeen} onClose={() => setOpen(null)} />}
    </>
  );
}

function Viewer({
  stories,
  start,
  labels,
  onSeen,
  onClose,
}: {
  stories: StoryView[];
  start: number;
  labels: Labels;
  onSeen: (s: StoryView) => void;
  onClose: () => void;
}) {
  const [si, setSi] = useState(start);
  const [fi, setFi] = useState(0);
  const [progress, setProgress] = useState(0);
  const [paused, setPaused] = useState(false);
  const [muted, setMuted] = useState(true);
  const video = useRef<HTMLVideoElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const touch = useRef<{ x: number; y: number; t: number } | null>(null);

  const story = stories[si];
  const frame = story.frames[fi];

  const next = useCallback(() => {
    setProgress(0);
    if (fi < story.frames.length - 1) return setFi(fi + 1);
    if (si < stories.length - 1) {
      setSi(si + 1);
      setFi(0);
      return;
    }
    onClose();
  }, [fi, si, story.frames.length, stories.length, onClose]);

  const prev = useCallback(() => {
    setProgress(0);
    if (fi > 0) return setFi(fi - 1);
    if (si > 0) {
      setSi(si - 1);
      setFi(stories[si - 1].frames.length - 1);
    }
  }, [fi, si, stories]);

  // İzlendi işareti, kaydırmayı kilitle, odak
  useEffect(() => onSeen(story), [story, onSeen]);
  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    const opener = document.activeElement as HTMLElement | null;
    document.body.style.overflow = "hidden";
    dialog.current?.focus();
    return () => {
      document.body.style.overflow = prevOverflow;
      opener?.focus();
    };
  }, []);

  // Görsel karelerde zamanlayıcı
  useEffect(() => {
    if (frame.kind !== "image" || paused) return;
    let raf = 0;
    const begin = performance.now() - progress * IMAGE_MS;
    const tick = (now: number) => {
      const p = Math.min(1, (now - begin) / IMAGE_MS);
      setProgress(p);
      if (p >= 1) next();
      else raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [si, fi, paused, frame.kind]);

  // Video kareler
  useEffect(() => {
    const v = video.current;
    if (!v || frame.kind !== "video") return;
    if (paused) v.pause();
    else v.play().catch(() => undefined);
  }, [paused, frame, si, fi]);

  // Klavye
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") next();
      else if (e.key === "ArrowLeft") prev();
      else if (e.key === " ") {
        e.preventDefault();
        setPaused((p) => !p);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [next, prev, onClose]);

  return (
    <div
      ref={dialog}
      role="dialog"
      aria-modal="true"
      aria-label={story.title}
      tabIndex={-1}
      className="fixed inset-0 z-[60] flex items-center justify-center bg-ink/95 outline-none"
    >
      <button type="button" onClick={prev} aria-label={labels.prev} disabled={si === 0 && fi === 0} className="mr-4 hidden h-12 w-12 place-items-center rounded-full bg-white/10 text-2xl text-white hover:bg-white/20 disabled:opacity-20 md:grid">
        ‹
      </button>

      <div className="relative h-dvh w-full overflow-hidden bg-black md:h-[min(92dvh,52rem)] md:w-auto md:aspect-[9/16] md:rounded-2xl">
        {/* Kare */}
        {frame.kind === "video" ? (
          <video
            key={`${si}-${fi}`}
            ref={video}
            src={frame.url}
            muted={muted}
            playsInline
            autoPlay
            preload="auto"
            onTimeUpdate={(e) => {
              const v = e.currentTarget;
              if (v.duration) setProgress(v.currentTime / v.duration);
            }}
            onEnded={next}
            className="h-full w-full object-contain"
          />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={`${si}-${fi}`} src={frame.url} alt={frame.caption || story.title} className="h-full w-full object-contain" />
        )}

        {/* Dokunma alanları: sol geri, sağ ileri, basılı tut duraklat, aşağı kaydır kapat */}
        <div
          className="absolute inset-0 flex"
          onPointerDown={(e) => {
            touch.current = { x: e.clientX, y: e.clientY, t: Date.now() };
            setPaused(true);
          }}
          onPointerUp={(e) => {
            const s = touch.current;
            touch.current = null;
            setPaused(false);
            if (!s) return;
            const dy = e.clientY - s.y;
            const dx = e.clientX - s.x;
            if (dy > 90 && Math.abs(dy) > Math.abs(dx)) return onClose();
            if (Math.abs(dx) > 60) return dx < 0 ? next() : prev();
            if (Date.now() - s.t > 350) return; // basılı tutma: yalnız duraklatır
            const rect = e.currentTarget.getBoundingClientRect();
            if (e.clientX - rect.left < rect.width / 3) prev();
            else next();
          }}
          onPointerCancel={() => {
            touch.current = null;
            setPaused(false);
          }}
          aria-hidden="true"
        />

        {/* Üst: ilerleme çubukları ve başlık */}
        <div className="pointer-events-none absolute inset-x-0 top-0 bg-gradient-to-b from-black/60 to-transparent p-3 pb-10">
          <div className="flex gap-1">
            {story.frames.map((_, i) => (
              <span key={i} className="h-[3px] flex-1 overflow-hidden rounded-full bg-white/35">
                <span className="block h-full bg-white" style={{ width: `${i < fi ? 100 : i === fi ? progress * 100 : 0}%` }} />
              </span>
            ))}
          </div>
          <div className="mt-3 flex items-center gap-2">
            <span className="text-sm font-semibold text-white">{story.title}</span>
            <span className="text-xs text-white/60">
              {fi + 1}/{story.frames.length}
            </span>
          </div>
        </div>

        <div className="absolute right-2 top-7 flex gap-1">
          {frame.kind === "video" && (
            <button
              type="button"
              onClick={() => setMuted((m) => !m)}
              aria-label={muted ? labels.unmute : labels.mute}
              className="grid h-11 w-11 place-items-center rounded-full text-white hover:bg-white/15"
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M11 5 6 9H2v6h4l5 4V5z" />
                {muted ? <path d="m23 9-6 6M17 9l6 6" /> : <path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14" />}
              </svg>
            </button>
          )}
          <button
            type="button"
            onClick={() => setPaused((p) => !p)}
            aria-label={paused ? labels.play : labels.pause}
            className="grid h-11 w-11 place-items-center rounded-full text-white hover:bg-white/15"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              {paused ? <path d="M7 4v16l13-8z" /> : <path d="M6 4h4v16H6zM14 4h4v16h-4z" />}
            </svg>
          </button>
          <button type="button" onClick={onClose} aria-label={labels.close} className="grid h-11 w-11 place-items-center rounded-full text-white hover:bg-white/15">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>

        {/* Alt: altyazı ve bağlantı */}
        {(frame.caption || story.link) && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 to-transparent p-5 pt-16">
            {frame.caption && <p className="text-[15px] leading-snug text-white">{frame.caption}</p>}
            {story.link && (
              <a href={story.link.href} className="pointer-events-auto mt-4 inline-block rounded-full bg-smile px-5 py-3 text-sm font-semibold text-navy hover:bg-white">
                {story.link.label}
              </a>
            )}
          </div>
        )}
      </div>

      <button type="button" onClick={next} aria-label={labels.next} className="ml-4 hidden h-12 w-12 place-items-center rounded-full bg-white/10 text-2xl text-white hover:bg-white/20 md:grid">
        ›
      </button>
    </div>
  );
}
