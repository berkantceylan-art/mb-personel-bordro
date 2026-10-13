"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Locale } from "@/lib/i18n";

export type AdSlide = {
  id: string;
  builtin: string | null;
  img: string | null;
  imgMobile: string | null;
  video: string | null;
  title: string;
  sub: string;
  label: string;
  href: string | null;
};

const INTERVAL = 7000;

const HOUSE: Record<Locale, Record<"promo" | "tracking" | "visit", { kicker: string; title: string; sub: string; cta: string; more: string; steps: string[] }>> = {
  tr: {
    promo: { kicker: "Hekim portalı", title: "Vakanızı telefonla değil, 2 dakikada portaldan gönderin", sub: "Taramayı yükleyin, dişi ve rengi seçin, gönderin. Bilgi kaybolmaz, hata olmaz.", cta: "Ücretsiz hesap aç", more: "Nasıl çalışır?", steps: ["Taramayı yükle", "Diş ve rengi seç", "Gönder"] },
    visit: { kicker: "Ziyaretçi randevusu", title: "Bize gelmeden randevu alın, kapıda QR ile girin", sub: "Gün ve saati seçin, ziyaret edeceğiniz kişi onaylasın; QR davetiyeniz telefonunuza gelsin. Bekleme yok, form doldurma yok.", cta: "Randevu al", more: "İletişim", steps: ["Randevu iste", "Onaylansın", "QR ile gir"] },
    tracking: { kicker: "Canlı takip", title: "İşiniz nerede? Sormanıza gerek yok.", sub: "Tasarımdan teslime her aşama anında ekranınızda; teknisyenle vaka içinden yazışın.", cta: "Hemen başla", more: "Yardım merkezi", steps: ["Alındı", "Tasarım", "Üretim", "Kalite", "Kargoda", "Teslim"] },
  },
  en: {
    promo: { kicker: "Doctor portal", title: "Send your case in 2 minutes — no phone calls", sub: "Upload the scan, pick the teeth and shade, send. Nothing gets lost, nothing gets misread.", cta: "Open a free account", more: "How it works", steps: ["Upload the scan", "Pick teeth & shade", "Send"] },
    visit: { kicker: "Visitor booking", title: "Book before you visit, enter with a QR code", sub: "Pick a day and time, the person you visit approves, and your QR invitation lands on your phone. No waiting, no forms at the gate.", cta: "Book a visit", more: "Contact", steps: ["Request a slot", "Get approved", "Enter with QR"] },
    tracking: { kicker: "Live tracking", title: "Where's my case? No need to ask.", sub: "Every stage from design to delivery shows up instantly; message the technician inside the case.", cta: "Get started", more: "Help centre", steps: ["Received", "Design", "Production", "Quality", "Shipped", "Delivered"] },
  },
  fr: {
    promo: { kicker: "Portail praticien", title: "Envoyez votre cas en 2 minutes, sans téléphone", sub: "Téléversez le scan, choisissez dents et teinte, envoyez. Rien ne se perd, aucune erreur.", cta: "Ouvrir un compte gratuit", more: "Comment ça marche ?", steps: ["Téléversez le scan", "Dents et teinte", "Envoyez"] },
    visit: { kicker: "Rendez-vous visiteur", title: "Réservez avant de venir, entrez avec un QR code", sub: "Choisissez jour et heure, la personne concernée valide et votre invitation QR arrive sur votre téléphone. Sans attente ni formulaire à l’accueil.", cta: "Prendre rendez-vous", more: "Contact", steps: ["Demandez un créneau", "Validation", "Entrée par QR"] },
    tracking: { kicker: "Suivi en direct", title: "Où en est mon cas ? Plus besoin de demander.", sub: "Chaque étape, de la conception à la livraison, s’affiche aussitôt ; échangez avec le technicien dans le cas.", cta: "Commencer", more: "Centre d’aide", steps: ["Reçu", "Conception", "Fabrication", "Qualité", "Expédié", "Livré"] },
  },
};
const LABELS: Record<Locale, { prev: string; next: string; go: string; region: string }> = {
  tr: { prev: "Önceki", next: "Sonraki", go: "Reklama git", region: "Duyuru ve kampanyalar" },
  en: { prev: "Previous", next: "Next", go: "Go to slide", region: "Announcements and offers" },
  fr: { prev: "Précédent", next: "Suivant", go: "Aller à la diapositive", region: "Annonces et offres" },
};

/**
 * Ana sayfa reklam alanı: ERP › Site içerikleri'nden eklenen reklamlar ve hazır portal reklamları otomatik döner.
 * Sabit en-boy oranlı kutu: içerik ne olursa olsun sayfanın geri kalanını kaydırmaz.
 */
export function AdCarousel({ slides, locale }: { slides: AdSlide[]; locale: Locale }) {
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  const n = slides.length;
  const touch = useRef<number | null>(null);
  const go = useCallback((k: number) => setI(((k % n) + n) % n), [n]);
  useEffect(() => {
    if (n < 2 || paused) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const t = setTimeout(() => go(i + 1), INTERVAL);
    return () => clearTimeout(t);
  }, [i, n, paused, go]);
  if (!n) return null;
  const L = LABELS[locale];

  return (
    <section aria-roledescription="carousel" aria-label={L.region} className="ad border-b border-gypsum bg-white"
      onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)} onFocusCapture={() => setPaused(true)} onBlurCapture={() => setPaused(false)}>
      <style>{CSS}</style>
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-10">
        <div className="relative overflow-hidden rounded-3xl bg-navy"
          onTouchStart={(e) => { touch.current = e.touches[0]?.clientX ?? null; }}
          onTouchEnd={(e) => { const x = touch.current; touch.current = null; const end = e.changedTouches[0]?.clientX; if (x != null && end != null && Math.abs(end - x) > 40) go(end < x ? i + 1 : i - 1); }}>
          <div className="relative aspect-[4/5] sm:aspect-[16/8] lg:aspect-[21/8]">
            {slides.map((s, k) => (
              <div key={s.id} role="group" aria-roledescription="slide" aria-label={`${k + 1} / ${n}`} aria-hidden={k !== i}
                className={`absolute inset-0 transition-opacity duration-700 ${k === i ? "opacity-100" : "pointer-events-none opacity-0"}`}>
                {s.builtin ? <House kind={s.builtin === "portal-tracking" ? "tracking" : s.builtin === "visit-booking" ? "visit" : "promo"} s={s} locale={locale} active={k === i} /> : <ImageSlide s={s} active={k === i} />}
              </div>
            ))}
          </div>
          {n > 1 && (
            <>
              <button type="button" onClick={() => go(i - 1)} aria-label={L.prev} className="absolute left-3 top-1/2 hidden h-10 w-10 -translate-y-1/2 place-items-center rounded-full bg-white/15 text-xl text-white backdrop-blur hover:bg-white hover:text-navy sm:grid">‹</button>
              <button type="button" onClick={() => go(i + 1)} aria-label={L.next} className="absolute right-3 top-1/2 hidden h-10 w-10 -translate-y-1/2 place-items-center rounded-full bg-white/15 text-xl text-white backdrop-blur hover:bg-white hover:text-navy sm:grid">›</button>
              <div className="absolute inset-x-0 bottom-3 flex justify-center gap-2">
                {slides.map((s, k) => (
                  <button key={s.id} type="button" onClick={() => go(k)} aria-label={`${L.go} ${k + 1}`} aria-current={k === i}
                    className="h-2 overflow-hidden rounded-full bg-white/30 transition-all" style={{ width: k === i ? 32 : 8 }}>
                    {k === i && !paused && <span key={i} className="ad-bar block h-full bg-smile" style={{ animationDuration: `${INTERVAL}ms` }} />}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

function ImageSlide({ s, active }: { s: AdSlide; active: boolean }) {
  const content = (
    <>
      {s.video ? (
        <video src={s.video} poster={s.img ?? undefined} className="absolute inset-0 h-full w-full object-cover" muted loop playsInline autoPlay={active} preload="metadata" />
      ) : s.img ? (
        <picture>
          {s.imgMobile && <source media="(max-width: 639px)" srcSet={s.imgMobile} />}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={s.img} alt={s.title} className={`absolute inset-0 h-full w-full object-cover transition-transform duration-[8000ms] ${active ? "scale-105" : "scale-100"}`} loading="lazy" />
        </picture>
      ) : null}
      {(s.title || s.sub || s.label) && (
        <div className="absolute inset-0 flex items-end bg-gradient-to-t from-navy/85 via-navy/30 to-transparent p-6 sm:items-center sm:bg-gradient-to-r sm:from-navy/85 sm:via-navy/40 sm:p-12">
          <div className={`max-w-xl text-white ${active ? "ad-rise" : ""}`}>
            {s.title && <h2 className="display text-2xl font-semibold leading-tight sm:text-4xl">{s.title}</h2>}
            {s.sub && <p className="mt-2 text-white/80 sm:text-lg">{s.sub}</p>}
            {s.label && s.href && <span className="mt-4 inline-block rounded-full bg-smile px-5 py-2.5 font-semibold text-navy">{s.label} →</span>}
          </div>
        </div>
      )}
    </>
  );
  return s.href ? <a href={s.href} className="absolute inset-0 block" tabIndex={active ? 0 : -1}>{content}</a> : <div className="absolute inset-0">{content}</div>;
}

function House({ kind, s, locale, active }: { kind: "promo" | "tracking" | "visit"; s: AdSlide; locale: Locale; active: boolean }) {
  const h = HOUSE[locale][kind];
  const title = s.title || h.title;
  const sub = s.sub || h.sub;
  const cta = s.label || h.cta;
  const href = kind === "visit" ? `/${locale}/ziyaret` : s.href && s.href !== "/portal/kayit" ? s.href : `/portal/kayit?dil=${locale}`;
  const moreHref = kind === "visit" ? `/${locale}/iletisim` : `/${locale}/yardim`;
  return (
    <div className="absolute inset-0 grid overflow-hidden bg-[radial-gradient(circle_at_80%_20%,rgba(0,180,216,.35),transparent_45%),linear-gradient(135deg,#0b2545,#13315c)] sm:grid-cols-[1.1fr_1fr]">
      <div className={`relative z-10 flex flex-col justify-center p-6 text-white sm:p-12 ${active ? "ad-rise" : ""}`}>
        <span className="text-xs font-semibold uppercase tracking-[.2em] text-smile">{h.kicker}</span>
        <h2 className="display mt-2 text-2xl font-semibold leading-tight sm:text-4xl">{title}</h2>
        <p className="mt-3 text-white/75 sm:text-lg">{sub}</p>
        <div className="mt-5 flex flex-wrap gap-2">
          <a href={href} tabIndex={active ? 0 : -1} className="rounded-full bg-smile px-5 py-2.5 font-semibold text-navy hover:bg-white">{cta} →</a>
          <a href={moreHref} tabIndex={active ? 0 : -1} className="rounded-full border border-white/30 px-5 py-2.5 font-semibold text-white hover:border-white">{h.more}</a>
        </div>
      </div>
      <div className="relative hidden items-center justify-center p-8 sm:flex" aria-hidden>
        {kind !== "tracking" ? (
          <div key={String(active)} className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl">
            {h.steps.map((st, k) => (
              <div key={st} className={`flex items-center gap-3 rounded-xl p-3 ${active ? "ad-step" : ""}`} style={{ animationDelay: `${0.4 + k * 0.9}s` }}>
                <span className="ad-check grid h-9 w-9 shrink-0 place-items-center rounded-full bg-gypsum text-white" style={{ animationDelay: `${0.8 + k * 0.9}s` }}>✓</span>
                <span className="font-semibold text-navy">{st}</span>
                <span className="ml-auto text-2xl">{(kind === "visit" ? ["📅", "✅", "📱"] : ["📎", "🦷", "🚀"])[k]}</span>
              </div>
            ))}
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-gypsum"><div className={`h-full bg-smile ${active ? "ad-fill" : ""}`} /></div>
            <p className="mt-2 text-right text-xs font-semibold text-slate">{kind === "visit" ? "🚪 QR" : "⏱ 2 dk"}</p>
          </div>
        ) : (
          <div key={String(active)} className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl">
            <div className="flex items-start">
              {h.steps.map((st, k) => (
                <div key={st} className="relative flex flex-1 flex-col items-center text-center">
                  {k > 0 && <div className="absolute right-1/2 top-3.5 h-1 w-full bg-gypsum"><div className={`h-full bg-smile ${active ? "ad-fill" : ""}`} style={{ animationDelay: `${0.3 + k * 0.5}s`, animationDuration: ".5s" }} /></div>}
                  <span className={`relative z-10 grid h-8 w-8 place-items-center rounded-full bg-gypsum text-xs font-bold text-white ${active ? "ad-dot" : ""}`} style={{ animationDelay: `${0.5 + k * 0.5}s` }}>✓</span>
                  <span className="mt-1 text-[10px] font-semibold text-ink">{st}</span>
                </div>
              ))}
            </div>
            <div className={`mt-5 rounded-xl bg-porcelain p-3 text-sm text-ink ${active ? "ad-step" : ""}`} style={{ animationDelay: "3.4s" }}>💬 <b className="text-navy">Lab:</b> ✓ 🚚 DHL 4823 1190 22</div>
          </div>
        )}
      </div>
    </div>
  );
}

const CSS = `
.ad .ad-rise>*{opacity:0;animation:adRise .6s ease forwards}
.ad .ad-rise>*:nth-child(2){animation-delay:.12s}.ad .ad-rise>*:nth-child(3){animation-delay:.24s}.ad .ad-rise>*:nth-child(4){animation-delay:.36s}
.ad .ad-step{opacity:0;animation:adRise .5s ease forwards}
.ad .ad-check{animation:adCheck .3s ease forwards;animation-fill-mode:forwards}
.ad .ad-step .ad-check{animation:adCheck .3s ease forwards}
.ad .ad-fill{transform:scaleX(0);transform-origin:left;animation:adFill 3.4s ease forwards}
.ad .ad-dot{animation:adCheck .3s ease forwards}
.ad .ad-bar{width:0;animation:adBar linear forwards}
@keyframes adRise{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}
@keyframes adCheck{to{background:#00b4d8}}
@keyframes adFill{to{transform:scaleX(1)}}
@keyframes adBar{to{width:100%}}
@media (prefers-reduced-motion:reduce){.ad *{animation-duration:.01s!important;animation-delay:0s!important}}
`;
