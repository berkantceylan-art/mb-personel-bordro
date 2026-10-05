"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { chatForget, chatSend, chatStart, chatState } from "@/lib/chat-actions";
import { HUB_UI, type ChatMessage, type ChatSnapshot } from "@/lib/chat-ui";
import { openState, type OpenState, type Schedule } from "@/lib/hours";
import type { Locale } from "@/lib/i18n";

type Props = {
  locale: Locale;
  phone: string;
  tel: string;
  email: string;
  whatsapp: string;
  schedule: Schedule;
  chatEnabled: boolean;
};

type Tab = "chat" | "whatsapp" | "contact";

const WA_PATH =
  "M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2a8.2 8.2 0 0 1-4.2-1.1l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8s-.4-.1-.6.1-.7.8-.8 1-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.2-.4.6-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.3.8 3.2.6a2.7 2.7 0 0 0 1.8-1.2 2.2 2.2 0 0 0 .2-1.3c-.1-.1-.3-.2-.5-.3z";

/** Sağ alttaki "Destek" düğmesi: canlı destek, konulu WhatsApp, telefon/e-posta */
export function SupportHub({ locale, phone, tel, email, whatsapp, schedule, chatEnabled }: Props) {
  const ui = HUB_UI[locale];
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>(chatEnabled ? "chat" : whatsapp ? "whatsapp" : "contact");
  const [state, setState] = useState<OpenState | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chat, setChat] = useState<ChatSnapshot["chat"]>(null);
  const [error, setError] = useState<ChatSnapshot["error"]>();
  const [unread, setUnread] = useState(0);
  const [showTop, setShowTop] = useState(false);
  const [pending, start] = useTransition();
  const lastId = useRef(0);
  const seenId = useRef(0);
  const startedAt = useRef(0);
  const listRef = useRef<HTMLOListElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Açık/kapalı durumu (Türkiye saati) — dakikada bir güncellenir
  useEffect(() => {
    const tick = () => setState(openState(schedule, locale));
    tick();
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, [schedule, locale]);

  // "Başa dön" düğmesi
  useEffect(() => {
    const onScroll = () => setShowTop(window.scrollY > 900);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const apply = useCallback(
    (snap: ChatSnapshot, panelOpen: boolean) => {
      if (snap.error) setError(snap.error);
      if (!snap.chat) {
        if (snap.error === "gone") {
          setChat(null);
          setMessages([]);
          lastId.current = 0;
        }
        return;
      }
      setChat(snap.chat);
      const fresh = snap.chat.messages.filter((m) => m.id > lastId.current);
      if (fresh.length) {
        lastId.current = fresh[fresh.length - 1].id;
        setMessages((prev) => [...prev, ...fresh]);
      }
      if (panelOpen) {
        seenId.current = lastId.current;
        setUnread(0);
      } else {
        setUnread((u) => u + fresh.filter((m) => m.sender === "staff" && m.id > seenId.current).length);
      }
    },
    [],
  );

  // İlk yüklemede önceki sohbet var mı
  useEffect(() => {
    if (!chatEnabled) return;
    let alive = true;
    chatState(0).then((s) => {
      if (!alive) return;
      if (s.chat) {
        lastId.current = 0;
        setMessages([]);
        seenId.current = s.chat.messages.reduce((m, x) => Math.max(m, x.id), 0);
        apply(s, true);
      }
    });
    return () => {
      alive = false;
    };
  }, [chatEnabled, apply]);

  // Yeni mesajları yokla: panel açıkken 4 sn, kapalıyken 30 sn
  useEffect(() => {
    if (!chatEnabled || !chat) return;
    const visible = open && tab === "chat";
    const id = setInterval(
      () => {
        if (document.hidden) return;
        chatState(lastId.current).then((s) => apply(s, visible));
      },
      visible ? 4000 : 30000,
    );
    return () => clearInterval(id);
  }, [chatEnabled, chat, open, tab, apply]);

  useEffect(() => {
    if (open && tab === "chat") {
      seenId.current = lastId.current;
      setUnread(0);
    }
  }, [open, tab]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages, open, tab]);

  useEffect(() => {
    if (!open) return;
    startedAt.current ||= Date.now();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    panelRef.current?.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  function onStart(form: FormData) {
    setError(undefined);
    start(async () => {
      const snap = await chatStart({
        name: String(form.get("name") ?? ""),
        email: String(form.get("email") ?? ""),
        body: String(form.get("body") ?? ""),
        website: String(form.get("website") ?? ""),
        locale,
        page: window.location.pathname,
        t: startedAt.current,
      });
      apply(snap, true);
    });
  }

  function onSend(form: FormData, el: HTMLFormElement) {
    const body = String(form.get("body") ?? "").trim();
    if (!body) return;
    setError(undefined);
    el.reset();
    start(async () => apply(await chatSend(body, lastId.current), true));
  }

  function onNewChat() {
    start(async () => {
      await chatForget();
      setChat(null);
      setMessages([]);
      lastId.current = 0;
      seenId.current = 0;
      setError(undefined);
    });
  }

  const tabs: Tab[] = [...(chatEnabled ? (["chat"] as Tab[]) : []), ...(whatsapp ? (["whatsapp"] as Tab[]) : []), "contact"];
  const fmt = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" });

  return (
    <div className="support-hub fixed bottom-4 right-4 z-50 flex flex-col items-end gap-3 sm:bottom-5 sm:right-5">
      {open && (
        <div
          ref={panelRef}
          id="destek-paneli"
          role="dialog"
          aria-modal="false"
          aria-labelledby="destek-baslik"
          className="hub-panel flex max-h-[min(40rem,calc(100dvh-6.5rem))] w-[min(23.5rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-3xl bg-white text-ink shadow-2xl shadow-navy/30 ring-1 ring-navy/10"
        >
          <div className="relative bg-navy px-5 pb-4 pt-5 text-white">
            <div className="absolute inset-0 -z-0 bg-[radial-gradient(120%_80%_at_100%_0%,rgba(43,196,238,.35),transparent_60%)]" aria-hidden="true" />
            <div className="relative flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <h2 id="destek-baslik" className="display text-lg font-semibold leading-tight">
                  {ui.title}
                </h2>
                <p className="mt-1 text-sm text-white/70">{ui.lead}</p>
                {state && (
                  <p className="mt-2 inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs">
                    <span aria-hidden="true" className={`h-2 w-2 rounded-full ${state.open ? "bg-[#3ddc84] shadow-[0_0_0_3px_rgba(61,220,132,.25)]" : "bg-white/40"}`} />
                    <span className="font-semibold">{state.open ? HUB_STATE[locale].open : HUB_STATE[locale].closed}</span>
                    {state.label && <span className="text-white/65">· {state.label}</span>}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  buttonRef.current?.focus();
                }}
                aria-label={ui.close}
                className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-2xl leading-none text-white/80 hover:bg-white/10 hover:text-white"
              >
                ×
              </button>
            </div>
            {tabs.length > 1 && (
              <div role="tablist" aria-label={ui.title} className="relative mt-4 flex gap-1 rounded-full bg-white/10 p-1 text-sm">
                {tabs.map((k) => (
                  <button
                    key={k}
                    type="button"
                    role="tab"
                    id={`destek-sekme-${k}`}
                    aria-selected={tab === k}
                    aria-controls={`destek-icerik-${k}`}
                    onClick={() => setTab(k)}
                    className={`flex-1 rounded-full px-2 py-1.5 font-semibold ${tab === k ? "bg-white text-navy" : "text-white/80 hover:text-white"}`}
                  >
                    {ui.tabs[k]}
                    {k === "chat" && unread > 0 && <span className="ml-1 rounded-full bg-smile px-1.5 text-xs text-navy">{unread}</span>}
                  </button>
                ))}
              </div>
            )}
          </div>

          {tab === "chat" && chatEnabled && (
            <div role="tabpanel" id="destek-icerik-chat" aria-labelledby="destek-sekme-chat" className="flex min-h-0 flex-1 flex-col">
              {!chat ? (
                <form action={onStart} className="grid gap-3 overflow-y-auto p-5">
                  <p className={`rounded-2xl px-4 py-3 text-sm ${state && !state.open ? "bg-porcelain text-slate" : "bg-smile/15 text-navy"}`}>
                    {state && !state.open ? ui.offline : ui.online}
                  </p>
                  <label className="grid gap-1 text-sm font-semibold text-navy">
                    {ui.name}
                    <input data-autofocus name="name" required maxLength={120} autoComplete="name" className="field font-normal" />
                  </label>
                  <label className="grid gap-1 text-sm font-semibold text-navy">
                    {ui.email}
                    <input name="email" type="email" maxLength={200} autoComplete="email" className="field font-normal" aria-describedby="destek-eposta-not" />
                    <span id="destek-eposta-not" className="text-xs font-normal text-slate">
                      {ui.emailHint}
                    </span>
                  </label>
                  <label className="grid gap-1 text-sm font-semibold text-navy">
                    {ui.message}
                    <textarea name="body" required maxLength={2000} rows={3} className="field font-normal" />
                  </label>
                  <input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" className="hidden" />
                  {error && (
                    <p role="alert" className="text-sm text-bad">
                      {ui.errors[error]}
                    </p>
                  )}
                  <button type="submit" disabled={pending} className="rounded-full bg-navy px-5 py-3 font-semibold text-white hover:bg-blue disabled:opacity-60">
                    {pending ? "…" : ui.start}
                  </button>
                </form>
              ) : (
                <>
                  <ol ref={listRef} aria-live="polite" className="flex min-h-[12rem] flex-1 flex-col gap-2 overflow-y-auto bg-porcelain px-4 py-4">
                    {messages.map((m) => (
                      <li key={m.id} className={`flex max-w-[85%] flex-col ${m.sender === "visitor" ? "self-end items-end" : "self-start items-start"}`}>
                        <span
                          className={`whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-[15px] leading-snug ${
                            m.sender === "visitor" ? "rounded-br-md bg-navy text-white" : "rounded-bl-md bg-white text-ink ring-1 ring-gypsum"
                          }`}
                        >
                          {m.body}
                        </span>
                        <span className="mt-0.5 px-1 text-[11px] text-slate">
                          {m.sender === "visitor" ? ui.you : ui.lab} · {fmt.format(new Date(m.at))}
                        </span>
                      </li>
                    ))}
                    {chat.status === "closed" && <li className="self-center rounded-full bg-gypsum px-3 py-1 text-xs text-slate">{ui.closedNote}</li>}
                    {messages.length > 0 && messages.every((m) => m.sender === "visitor") && state && !state.open && (
                      <li className="self-start max-w-[85%] rounded-2xl rounded-bl-md bg-white px-3.5 py-2 text-sm text-slate ring-1 ring-gypsum">{ui.offline}</li>
                    )}
                  </ol>
                  {error && (
                    <p role="alert" className="bg-white px-4 pt-2 text-sm text-bad">
                      {ui.errors[error]}
                    </p>
                  )}
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      onSend(new FormData(e.currentTarget), e.currentTarget);
                    }}
                    className="flex items-end gap-2 border-t border-gypsum bg-white p-3"
                  >
                    <label htmlFor="destek-mesaj" className="sr-only">
                      {ui.placeholder}
                    </label>
                    <textarea
                      id="destek-mesaj"
                      data-autofocus
                      name="body"
                      rows={1}
                      maxLength={2000}
                      placeholder={ui.placeholder}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          e.currentTarget.form?.requestSubmit();
                        }
                      }}
                      className="field max-h-32 min-h-11 flex-1 resize-none"
                    />
                    <button type="submit" disabled={pending} aria-label={ui.send} className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-navy text-white hover:bg-blue disabled:opacity-60">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M5 12h14M13 6l6 6-6 6" />
                      </svg>
                    </button>
                  </form>
                  <div className="flex justify-end bg-white px-4 pb-3">
                    <button type="button" onClick={onNewChat} className="text-xs font-semibold text-slate hover:text-navy">
                      {ui.newChat}
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {tab === "whatsapp" && whatsapp && (
            <div role="tabpanel" id="destek-icerik-whatsapp" aria-labelledby="destek-sekme-whatsapp" className="overflow-y-auto p-5">
              <p className="text-sm text-slate">{ui.waLead}</p>
              <ul className="mt-3 grid gap-2">
                {ui.waTopics.map((w, i) => (
                  <li key={w.label}>
                    <a
                      data-autofocus={i === 0 ? true : undefined}
                      href={`https://wa.me/${whatsapp}?text=${encodeURIComponent(w.text)}`}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-3 rounded-2xl border border-gypsum px-4 py-3 font-semibold text-ink hover:border-[#1f8f4e] hover:bg-[#1f8f4e]/5"
                    >
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="#1f8f4e" aria-hidden="true">
                        <path d={WA_PATH} />
                      </svg>
                      <span className="flex-1">{w.label}</span>
                      <span aria-hidden="true" className="text-slate">
                        ↗
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {tab === "contact" && (
            <div role="tabpanel" id="destek-icerik-contact" aria-labelledby="destek-sekme-contact" className="grid gap-3 overflow-y-auto p-5">
              <a data-autofocus href={tel} className="flex items-center gap-3 rounded-2xl bg-navy px-4 py-3 text-white hover:bg-blue">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2" />
                </svg>
                <span className="flex-1">
                  <span className="block text-xs text-white/65">{ui.call}</span>
                  <span className="font-semibold">{phone}</span>
                </span>
              </a>
              <a href={`mailto:${email}`} className="flex items-center gap-3 rounded-2xl border border-gypsum px-4 py-3 hover:border-navy">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-navy" aria-hidden="true">
                  <rect x="3" y="5" width="18" height="14" rx="2" />
                  <path d="m3 7 9 6 9-6" />
                </svg>
                <span className="flex-1">
                  <span className="block text-xs text-slate">{ui.write}</span>
                  <span className="font-semibold text-ink">{email}</span>
                </span>
              </a>
              <ul className="mt-1 grid grid-cols-2 gap-2 text-sm">
                {(
                  [
                    [`/${locale}/vaka-gonder`, ui.links.case],
                    ["/portal", ui.links.portal],
                    [`/${locale}/sss`, ui.links.faq],
                    [`/${locale}/iletisim`, ui.links.form],
                  ] as const
                ).map(([href, label]) => (
                  <li key={href}>
                    <Link href={href} onClick={() => setOpen(false)} className="block rounded-xl bg-porcelain px-3 py-2.5 font-semibold text-navy hover:bg-gypsum">
                      {label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <div className="flex items-center gap-2">
        {showTop && !open && (
          <button
            type="button"
            onClick={() => window.scrollTo({ top: 0, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" })}
            aria-label={ui.top}
            title={ui.top}
            className="grid h-11 w-11 place-items-center rounded-full bg-white text-navy shadow-lg shadow-ink/15 ring-1 ring-navy/10 hover:bg-porcelain"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 19V5M6 11l6-6 6 6" />
            </svg>
          </button>
        )}
        <button
          ref={buttonRef}
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls="destek-paneli"
          className="hub-button relative flex h-14 items-center gap-2 rounded-full bg-navy pl-4 pr-5 font-semibold text-white shadow-xl shadow-navy/30 ring-1 ring-white/25 hover:bg-blue"
        >
          {open ? (
            <span aria-hidden="true" className="grid w-6 place-items-center text-2xl leading-none">
              ×
            </span>
          ) : (
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.4A8 8 0 1 1 21 12z" />
              <path d="M8.5 11h.01M12 11h.01M15.5 11h.01" strokeWidth="2.8" />
            </svg>
          )}
          <span>{open ? ui.close : ui.button}</span>
          {state?.open && !open && <span aria-hidden="true" className="absolute right-1 top-1 h-3 w-3 rounded-full bg-[#3ddc84] ring-2 ring-navy" />}
          {unread > 0 && !open && (
            <span className="absolute -left-1 -top-1 grid h-6 min-w-6 place-items-center rounded-full bg-smile px-1 text-xs font-bold text-navy ring-2 ring-white">
              {unread}
              <span className="sr-only"> {NEW[locale]}</span>
            </span>
          )}
        </button>
      </div>
    </div>
  );
}

const HUB_STATE: Record<Locale, { open: string; closed: string }> = {
  tr: { open: "Şu an açığız", closed: "Şu an kapalıyız" },
  en: { open: "Open now", closed: "Closed now" },
  fr: { open: "Ouvert", closed: "Fermé" },
};

const NEW: Record<Locale, string> = { tr: "yeni mesaj", en: "new messages", fr: "nouveaux messages" };
