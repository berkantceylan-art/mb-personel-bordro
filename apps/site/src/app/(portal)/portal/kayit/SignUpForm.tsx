"use client";

import { useActionState } from "react";
import { portalSignUp, type SignUpState } from "@/lib/portal-actions";
import { PORTAL_UI, type PortalAccountType } from "@/lib/portal-ui";
import type { Locale } from "@/lib/i18n";

const COUNTRIES = ["TR", "FR", "BE", "CH", "DE", "NL", "GB", "IT", "ES", "AZ", "KZ", "DZ", "MA", "TN", "OTHER"];

export function SignUpForm({ locale }: { locale: Locale }) {
  const ui = PORTAL_UI[locale].signup;
  const types = PORTAL_UI[locale].types;
  const [state, action, pending] = useActionState<SignUpState, FormData>(portalSignUp, {});
  if (state.sent) {
    return (
      <p role="status" className="rounded-2xl bg-ok-bg p-6 font-semibold text-ok">
        {ui.checkEmail}
      </p>
    );
  }
  const regionName = (c: string) => {
    if (c === "OTHER") return locale === "tr" ? "Diğer" : locale === "fr" ? "Autre" : "Other";
    try {
      return new Intl.DisplayNames([locale], { type: "region" }).of(c) ?? c;
    } catch {
      return c;
    }
  };
  return (
    <form action={action} className="grid gap-4">
      <input type="hidden" name="language" value={locale} />
      {state.error && (
        <p role="alert" className="rounded-lg bg-bad-bg px-4 py-3 text-sm text-bad">
          {ui.errors[state.error]}
        </p>
      )}
      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm font-semibold text-navy">{ui.type}</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {(Object.keys(types) as PortalAccountType[]).map((k, i) => (
            <label key={k} className="flex cursor-pointer items-center gap-3 rounded-xl border border-gypsum bg-white px-4 py-3 text-sm has-[:checked]:border-navy has-[:checked]:bg-porcelain">
              <input type="radio" name="type" value={k} defaultChecked={locale === "tr" ? i === 0 : k === "doctor_foreign"} required />
              <span className="font-semibold text-ink">{types[k]}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="grid gap-1.5 text-sm font-semibold text-navy">
          {ui.name}
          <input name="name" required minLength={2} maxLength={160} autoComplete="name" className="field font-normal" />
        </label>
        <label className="grid gap-1.5 text-sm font-semibold text-navy">
          {ui.company}
          <input name="company" maxLength={160} autoComplete="organization" className="field font-normal" />
        </label>
        <label className="grid gap-1.5 text-sm font-semibold text-navy">
          {ui.country}
          <select name="country" defaultValue={locale === "fr" ? "FR" : locale === "en" ? "GB" : "TR"} className="field font-normal">
            {COUNTRIES.map((c) => (
              <option key={c} value={c}>
                {regionName(c)}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1.5 text-sm font-semibold text-navy">
          {ui.city}
          <input name="city" maxLength={80} autoComplete="address-level2" className="field font-normal" />
        </label>
        <label className="grid gap-1.5 text-sm font-semibold text-navy">
          {ui.phone}
          <input name="phone" type="tel" maxLength={40} autoComplete="tel" className="field font-normal" />
        </label>
        <label className="grid gap-1.5 text-sm font-semibold text-navy">
          {ui.email}
          <input name="email" type="email" required maxLength={200} autoComplete="email" className="field font-normal" />
        </label>
        <label className="grid gap-1.5 text-sm font-semibold text-navy sm:col-span-2">
          {ui.password}
          <input name="password" type="password" required minLength={8} autoComplete="new-password" className="field font-normal" />
          <span className="text-xs font-normal text-slate">{ui.passwordHint}</span>
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <button type="submit" disabled={pending} className="rounded-full bg-navy px-7 py-3 font-semibold text-white hover:bg-blue disabled:opacity-60">
          {pending ? "…" : ui.submit}
        </button>
        <p className="text-xs text-slate">{ui.privacy}</p>
      </div>
    </form>
  );
}
