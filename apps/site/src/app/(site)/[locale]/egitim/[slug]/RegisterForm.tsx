"use client";
import { useActionState } from "react";
import { registerEvent, type RegState } from "@/lib/event-actions";
import { EVT_UI } from "@/lib/pages-ui";
import type { Locale } from "@/lib/i18n";

export function RegisterForm({ eventId, locale }: { eventId: string; locale: Locale }) {
  const u = EVT_UI[locale];
  const [st, act, pending] = useActionState<RegState, FormData>(registerEvent, null);
  if (st?.ok) return <p className="rounded-2xl bg-emerald-50 p-5 font-semibold text-emerald-800">✓ {u.ok}</p>;
  return (
    <form action={act} className="grid gap-3">
      <input type="hidden" name="event_id" value={eventId} />
      <input name="website" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden />
      <input name="name" required minLength={2} placeholder={u.name} autoComplete="name" className="field" />
      <input name="email" type="email" required placeholder={u.email} autoComplete="email" className="field" />
      <div className="grid gap-3 sm:grid-cols-2"><input name="phone" type="tel" placeholder={u.phone} className="field" /><input name="clinic" placeholder={u.clinic} className="field" /></div>
      <input name="city" placeholder={u.city} className="field" />
      {st?.error && <p className="text-sm font-semibold text-bad">{st.error === "full" ? u.full : st.error === "past" ? u.passed : u.err}</p>}
      <button disabled={pending} className="rounded-full bg-navy px-6 py-3 font-semibold text-white disabled:opacity-60">{pending ? "…" : u.send}</button>
    </form>
  );
}
