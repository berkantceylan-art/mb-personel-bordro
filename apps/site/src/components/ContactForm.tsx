"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { sendMessage, type ContactState } from "@/lib/site-actions";
import type { Locale } from "@/lib/i18n";

const COPY: Record<
  Locale,
  {
    topic: string;
    topics: Record<"general" | "case" | "price" | "partner", string>;
    name: string;
    email: string;
    phone: string;
    company: string;
    country: string;
    message: string;
    optional: string;
    send: string;
    sending: string;
    ok: string;
    again: string;
    errors: Record<NonNullable<ContactState["error"]>, string>;
    privacy: string;
  }
> = {
  tr: {
    topic: "Konu",
    topics: { general: "Genel soru", case: "Vaka / iş gönderme", price: "Fiyat bilgisi", partner: "İş birliği / aracı kuruluş" },
    name: "Ad soyad",
    email: "E-posta",
    phone: "Telefon",
    company: "Klinik / firma",
    country: "Ülke / şehir",
    message: "Mesajınız",
    optional: "isteğe bağlı",
    send: "Gönder",
    sending: "Gönderiliyor…",
    ok: "Mesajınız bize ulaştı. En geç bir iş günü içinde dönüş yapacağız.",
    again: "Yeni mesaj yaz",
    errors: {
      required: "Lütfen ad, e-posta ve mesaj alanlarını doldurun.",
      email: "E-posta adresini kontrol edin.",
      rate: "Kısa sürede çok fazla mesaj gönderildi. Birkaç dakika sonra tekrar deneyin ya da bizi arayın.",
      spam: "Form çok hızlı gönderildi. Lütfen birkaç saniye bekleyip tekrar deneyin.",
      server: "Mesaj şu an gönderilemedi. Lütfen e-posta ya da telefonla ulaşın.",
    },
    privacy: "Bilgileriniz yalnız size dönüş yapmak için kullanılır.",
  },
  en: {
    topic: "Topic",
    topics: { general: "General question", case: "Sending a case", price: "Pricing", partner: "Partnership / agency" },
    name: "Full name",
    email: "Email",
    phone: "Phone",
    company: "Clinic / company",
    country: "Country / city",
    message: "Your message",
    optional: "optional",
    send: "Send",
    sending: "Sending…",
    ok: "Thank you — your message reached us. We reply within one business day.",
    again: "Write another message",
    errors: {
      required: "Please fill in your name, email and message.",
      email: "Please check your email address.",
      rate: "Too many messages in a short time. Please try again in a few minutes or call us.",
      spam: "The form was sent too quickly. Please wait a few seconds and try again.",
      server: "The message could not be sent right now. Please email or call us.",
    },
    privacy: "Your details are used only to reply to you.",
  },
  fr: {
    topic: "Sujet",
    topics: { general: "Question générale", case: "Envoyer un cas", price: "Tarifs", partner: "Partenariat / intermédiaire" },
    name: "Nom et prénom",
    email: "E-mail",
    phone: "Téléphone",
    company: "Cabinet / société",
    country: "Pays / ville",
    message: "Votre message",
    optional: "facultatif",
    send: "Envoyer",
    sending: "Envoi…",
    ok: "Merci, votre message nous est parvenu. Nous répondons sous un jour ouvré.",
    again: "Écrire un autre message",
    errors: {
      required: "Merci de renseigner votre nom, votre e-mail et votre message.",
      email: "Vérifiez votre adresse e-mail.",
      rate: "Trop de messages en peu de temps. Réessayez dans quelques minutes ou appelez-nous.",
      spam: "Le formulaire a été envoyé trop vite. Patientez quelques secondes et réessayez.",
      server: "Le message n'a pas pu être envoyé. Écrivez-nous ou appelez-nous.",
    },
    privacy: "Vos données servent uniquement à vous répondre.",
  },
};

export function ContactForm({
  locale,
  topic = "general",
  page,
  hidden = {},
  compact = false,
}: {
  locale: Locale;
  topic?: "general" | "case" | "price" | "partner";
  page: string;
  hidden?: Record<string, string>;
  compact?: boolean;
}) {
  const c = COPY[locale];
  const [state, action, pending] = useActionState(sendMessage, {});
  const [started, setStarted] = useState("");
  const [fresh, setFresh] = useState(0);
  const okRef = useRef<HTMLDivElement>(null);
  useEffect(() => setStarted(String(Date.now())), [fresh]);
  useEffect(() => {
    if (state.ok) okRef.current?.focus();
  }, [state]);

  if (state.ok && state.at && state.at > fresh) {
    return (
      <div ref={okRef} tabIndex={-1} role="status" className="rounded-2xl bg-ok-bg p-6 text-ok outline-none">
        <p className="font-semibold">{c.ok}</p>
        <button type="button" onClick={() => setFresh(Date.now())} className="mt-3 text-sm font-semibold underline underline-offset-4">
          {c.again}
        </button>
      </div>
    );
  }

  const field = "field w-full";
  return (
    <form key={state.at ?? 0} action={action} className="grid gap-4">
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="page" value={page} />
      <input type="hidden" name="t" value={started} />
      {Object.entries(hidden).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      {/* Botlar için görünmez alan */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
        <label>
          Website
          <input name="website" tabIndex={-1} autoComplete="off" />
        </label>
      </div>

      {state.error && (
        <p role="alert" className="rounded-lg bg-bad-bg px-4 py-3 text-sm text-bad">
          {c.errors[state.error]}
        </p>
      )}

      {!compact && (
        <label className="grid gap-1.5 text-sm font-semibold text-navy">
          {c.topic}
          <select name="topic" defaultValue={state.values?.topic || topic} className={`${field} font-normal`}>
            {(Object.keys(c.topics) as (keyof typeof c.topics)[]).map((k) => (
              <option key={k} value={k}>
                {c.topics[k]}
              </option>
            ))}
          </select>
        </label>
      )}
      {compact && <input type="hidden" name="topic" value={topic} />}

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="grid gap-1.5 text-sm font-semibold text-navy">
          {c.name}
          <input name="name" defaultValue={state.values?.name} required maxLength={120} autoComplete="name" className={`${field} font-normal`} />
        </label>
        <label className="grid gap-1.5 text-sm font-semibold text-navy">
          {c.email}
          <input name="email" type="email" defaultValue={state.values?.email} required maxLength={200} autoComplete="email" className={`${field} font-normal`} />
        </label>
        <label className="grid gap-1.5 text-sm font-semibold text-navy">
          <span>
            {c.phone} <span className="font-normal text-slate">({c.optional})</span>
          </span>
          <input name="phone" type="tel" defaultValue={state.values?.phone} maxLength={40} autoComplete="tel" className={`${field} font-normal`} />
        </label>
        <label className="grid gap-1.5 text-sm font-semibold text-navy">
          <span>
            {c.company} <span className="font-normal text-slate">({c.optional})</span>
          </span>
          <input name="company" defaultValue={state.values?.company} maxLength={160} autoComplete="organization" className={`${field} font-normal`} />
        </label>
      </div>
      {!compact && (
        <label className="grid gap-1.5 text-sm font-semibold text-navy">
          <span>
            {c.country} <span className="font-normal text-slate">({c.optional})</span>
          </span>
          <input name="country" defaultValue={state.values?.country} maxLength={80} autoComplete="country-name" className={`${field} font-normal`} />
        </label>
      )}
      <label className="grid gap-1.5 text-sm font-semibold text-navy">
        {c.message}
        <textarea name="message" defaultValue={state.values?.message} required maxLength={5000} rows={compact ? 4 : 6} className={`${field} font-normal`} />
      </label>
      <div className="flex flex-wrap items-center gap-4">
        <button type="submit" disabled={pending || !started} className="rounded-full bg-navy px-7 py-3 font-semibold text-white hover:bg-blue disabled:cursor-wait disabled:opacity-60">
          {pending ? c.sending : c.send}
        </button>
        <p className="text-xs text-slate">{c.privacy}</p>
      </div>
    </form>
  );
}
