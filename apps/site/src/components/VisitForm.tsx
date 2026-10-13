"use client";
import { useActionState, useMemo, useState } from "react";
import { requestVisit, type VisitState } from "@/lib/visit-actions";
import type { Locale } from "@/lib/i18n";

export type VisitHost = { id: string; label: string; description: string | null; weekdays: number[]; hour_from: number; hour_to: number; slot: number };

const UI: Record<Locale, Record<string, string>> = {
  tr: { who: "Kimi ziyaret edeceksiniz?", pick: "Seçin", day: "Gün", time: "Saat", name: "Ad soyad", company: "Firma / klinik (isteğe bağlı)", phone: "Telefon (WhatsApp)", email: "E-posta (isteğe bağlı)", count: "Kişi sayısı", purpose: "Ziyaret amacı", kvkk: "Kişisel verilerimin ziyaret ve güvenlik amacıyla işlenmesine ilişkin aydınlatma metnini okudum.", kvkkLink: "Aydınlatma metni", send: "Randevu iste", sending: "Gönderiliyor…", okTitle: "Talebiniz alındı", okText: "Ziyaret edeceğiniz kişi talebinizi onaylayınca QR davetiyeniz açılır; girişte güvenliğe göstermeniz yeterli. Durumu aşağıdaki bağlantıdan takip edin ve bağlantıyı kaydedin.", track: "Randevumu takip et", noDay: "Bu gün ziyaret kabul edilmiyor." },
  en: { who: "Who are you visiting?", pick: "Choose", day: "Day", time: "Time", name: "Full name", company: "Company / clinic (optional)", phone: "Phone (WhatsApp)", email: "Email (optional)", count: "Number of people", purpose: "Purpose of visit", kvkk: "I have read the privacy notice on processing my data for visit and security purposes.", kvkkLink: "Privacy notice", send: "Request appointment", sending: "Sending…", okTitle: "Request received", okText: "Once the person you are visiting approves, your QR invitation opens; just show it to security at the entrance. Track the status with the link below and keep it.", track: "Track my appointment", noDay: "No visits on this day." },
  fr: { who: "Qui venez-vous voir ?", pick: "Choisir", day: "Jour", time: "Heure", name: "Nom et prénom", company: "Société / cabinet (facultatif)", phone: "Téléphone (WhatsApp)", email: "E-mail (facultatif)", count: "Nombre de personnes", purpose: "Objet de la visite", kvkk: "J’ai lu la notice sur le traitement de mes données à des fins de visite et de sécurité.", kvkkLink: "Notice de confidentialité", send: "Demander un rendez-vous", sending: "Envoi…", okTitle: "Demande reçue", okText: "Dès que la personne concernée valide, votre invitation QR s’ouvre ; montrez-la à l’accueil sécurité. Suivez l’état avec le lien ci-dessous et conservez-le.", track: "Suivre mon rendez-vous", noDay: "Pas de visite ce jour-là." },
};

const iso = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const inp = "h-12 w-full rounded-xl border border-gypsum bg-white px-4 text-ink focus:border-smile focus:outline-none";

export function VisitForm({ locale, hosts, kvkkHref }: { locale: Locale; hosts: VisitHost[]; kvkkHref: string | null }) {
  const u = UI[locale];
  const [state, action, pending] = useActionState<VisitState, FormData>(requestVisit, { ok: false });
  const [hostId, setHostId] = useState(hosts.length === 1 ? hosts[0]!.id : "");
  const [day, setDay] = useState(iso(new Date(Date.now() + 86400000)));
  const host = hosts.find((h) => h.id === hostId);
  const isoDow = (s: string) => ((new Date(`${s}T12:00:00`).getDay() + 6) % 7) + 1;
  const slots = useMemo(() => {
    if (!host || !day) return [];
    if (!host.weekdays.includes(isoDow(day))) return [];
    const out: string[] = [];
    const now = Date.now() + 30 * 60000;
    for (let m = host.hour_from * 60; m <= host.hour_to * 60 - host.slot; m += host.slot) {
      const hh = String(Math.floor(m / 60)).padStart(2, "0");
      const mm = String(m % 60).padStart(2, "0");
      if (new Date(`${day}T${hh}:${mm}:00+03:00`).getTime() > now) out.push(`${hh}:${mm}`);
    }
    return out;
  }, [host, day]);

  if (state.ok && state.link) {
    return (
      <div className="rounded-2xl bg-white p-6 text-center">
        <span className="text-5xl">✅</span>
        <h2 className="display mt-3 text-2xl font-semibold text-navy">{u.okTitle}</h2>
        {state.no && <p className="font-mono text-sm text-slate">{state.no}</p>}
        <p className="mx-auto mt-3 max-w-md text-ink">{u.okText}</p>
        <a href={state.link} className="mt-5 inline-block rounded-full bg-smile px-6 py-3 font-semibold text-navy">{u.track} →</a>
      </div>
    );
  }
  return (
    <form action={action} className="grid gap-4">
      <input type="hidden" name="locale" value={locale} />
      <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden"><label>Website<input name="website" tabIndex={-1} autoComplete="off" /></label></div>
      <label className="grid gap-1.5 text-sm font-semibold text-navy">{u.who}
        <select name="host" required value={hostId} onChange={(e) => setHostId(e.target.value)} className={inp}>
          <option value="">{u.pick}</option>
          {hosts.map((h) => <option key={h.id} value={h.id}>{h.label}{h.description ? ` — ${h.description}` : ""}</option>)}
        </select>
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="grid gap-1.5 text-sm font-semibold text-navy">{u.day}
          <input type="date" name="day" required value={day} min={iso(new Date())} max={iso(new Date(Date.now() + 60 * 86400000))} onChange={(e) => setDay(e.target.value)} className={inp} />
        </label>
        <label className="grid gap-1.5 text-sm font-semibold text-navy">{u.time}
          <select name="time" required className={inp} disabled={!host}>
            {slots.length ? slots.map((s) => <option key={s} value={s}>{s}</option>) : <option value="">{host ? u.noDay : "—"}</option>}
          </select>
        </label>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="grid gap-1.5 text-sm font-semibold text-navy">{u.name}<input name="name" required minLength={2} maxLength={120} autoComplete="name" className={inp} /></label>
        <label className="grid gap-1.5 text-sm font-semibold text-navy">{u.company}<input name="company" maxLength={120} autoComplete="organization" className={inp} /></label>
        <label className="grid gap-1.5 text-sm font-semibold text-navy">{u.phone}<input name="phone" required inputMode="tel" autoComplete="tel" maxLength={40} className={inp} /></label>
        <label className="grid gap-1.5 text-sm font-semibold text-navy">{u.email}<input name="email" type="email" autoComplete="email" maxLength={200} className={inp} /></label>
      </div>
      <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
        <label className="grid gap-1.5 text-sm font-semibold text-navy">{u.purpose}<input name="purpose" maxLength={200} className={inp} /></label>
        <label className="grid gap-1.5 text-sm font-semibold text-navy">{u.count}<input name="count" type="number" min={1} max={20} defaultValue={1} className={inp} /></label>
      </div>
      <label className="flex items-start gap-3 text-sm text-ink">
        <input type="checkbox" name="kvkk" required className="mt-1 h-5 w-5 shrink-0" />
        <span>{u.kvkk}{kvkkHref && <> <a href={kvkkHref} target="_blank" rel="noreferrer" className="font-semibold text-navy underline">{u.kvkkLink}</a></>}</span>
      </label>
      {state.error && <p role="alert" className="rounded-lg bg-bad-bg px-4 py-3 text-sm text-bad">{state.error}</p>}
      <button disabled={pending} className="h-12 rounded-full bg-navy px-6 font-semibold text-white hover:bg-smile hover:text-navy disabled:opacity-50">{pending ? u.sending : u.send}</button>
    </form>
  );
}
