"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { adminChatReply, adminChatThread, type ThreadSnapshot } from "@/lib/chat-admin";
import type { ChatMessage } from "@/lib/chat-ui";

const QUICK: Record<string, string[]> = {
  tr: [
    "Merhaba, MB Dental'e hoş geldiniz. Size nasıl yardımcı olabilirim?",
    "Hemen kontrol edip size dönüyorum.",
    "Vaka numaranızı ya da hasta kodunuzu paylaşır mısınız?",
    "Fiyat listemizi e-posta adresinize gönderebiliriz; adresinizi yazar mısınız?",
    "Teşekkürler, iyi çalışmalar dileriz.",
  ],
  en: [
    "Hello, welcome to MB Dental. How can I help you?",
    "Let me check that and get right back to you.",
    "Could you share your case number or patient code?",
    "We can email you our price list; could you share your email address?",
    "Thank you, have a great day.",
  ],
  fr: [
    "Bonjour, bienvenue chez MB Dental. Comment puis-je vous aider ?",
    "Je vérifie et je reviens vers vous tout de suite.",
    "Pourriez-vous indiquer votre numéro de cas ou code patient ?",
    "Nous pouvons vous envoyer notre liste de prix par e-mail ; quelle est votre adresse ?",
    "Merci, excellente journée.",
  ],
};

/** Admin: canlı konuşma ekranı (4 sn'de bir yeni mesajları çeker) */
export function ChatThread({ id, initial, visitorName, locale }: { id: string; initial: ChatMessage[]; visitorName: string; locale: string }) {
  const [messages, setMessages] = useState(initial);
  const [error, setError] = useState<string>();
  const [text, setText] = useState("");
  const [pending, start] = useTransition();
  const lastId = useRef(initial.reduce((m, x) => Math.max(m, x.id), 0));
  const listRef = useRef<HTMLOListElement>(null);
  const fmt = new Intl.DateTimeFormat("tr-TR", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" });

  function apply(s: ThreadSnapshot) {
    setError(s.error);
    const fresh = s.messages.filter((m) => m.id > lastId.current);
    if (fresh.length) {
      lastId.current = fresh[fresh.length - 1].id;
      setMessages((p) => [...p, ...fresh]);
      if (document.hidden && fresh.some((m) => m.sender === "visitor")) document.title = `● Yeni mesaj — ${visitorName}`;
    }
  }

  useEffect(() => {
    const id2 = setInterval(() => {
      adminChatThread(id, lastId.current).then(apply);
    }, 4000);
    const onVis = () => {
      if (!document.hidden) document.title = "Canlı destek";
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(id2);
      document.removeEventListener("visibilitychange", onVis);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages]);

  function send(body: string) {
    const b = body.trim();
    if (!b) return;
    setText("");
    start(async () => apply(await adminChatReply(id, b, lastId.current)));
  }

  return (
    <section aria-label="Konuşma" className="flex min-h-[32rem] flex-col overflow-hidden rounded-2xl border border-gypsum bg-white">
      <ol ref={listRef} aria-live="polite" className="flex max-h-[60dvh] min-h-[22rem] flex-1 flex-col gap-2 overflow-y-auto bg-porcelain p-5">
        {messages.map((m) => (
          <li key={m.id} className={`flex max-w-[80%] flex-col ${m.sender === "staff" ? "self-end items-end" : "self-start items-start"}`}>
            <span
              className={`whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 leading-snug ${m.sender === "staff" ? "rounded-br-md bg-navy text-white" : "rounded-bl-md bg-white text-ink ring-1 ring-gypsum"}`}
            >
              {m.body}
            </span>
            <span className="mt-0.5 px-1 text-[11px] text-slate">
              {m.sender === "staff" ? "MB Dental" : visitorName} · {fmt.format(new Date(m.at))}
            </span>
          </li>
        ))}
      </ol>
      <div className="flex gap-2 overflow-x-auto border-t border-gypsum px-4 pt-3">
        {(QUICK[locale] ?? QUICK.tr).map((q) => (
          <button key={q} type="button" onClick={() => setText(q)} className="shrink-0 rounded-full bg-porcelain px-3 py-1.5 text-xs text-navy hover:bg-gypsum" title="Metni kutuya ekle">
            {q.length > 38 ? `${q.slice(0, 36)}…` : q}
          </button>
        ))}
      </div>
      {error && (
        <p role="alert" className="px-4 pt-2 text-sm text-bad">
          {error}
        </p>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(text);
        }}
        className="flex items-end gap-2 p-4"
      >
        <label htmlFor="cevap" className="sr-only">
          Cevabınız
        </label>
        <textarea
          id="cevap"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send(text);
            }
          }}
          rows={2}
          maxLength={2000}
          placeholder="Cevabınızı yazın (Enter gönderir, Shift+Enter yeni satır)"
          className="field flex-1 resize-y"
        />
        <button type="submit" disabled={pending || !text.trim()} className="rounded-full bg-navy px-5 py-3 font-semibold text-white hover:bg-blue disabled:opacity-50">
          Gönder
        </button>
      </form>
    </section>
  );
}
