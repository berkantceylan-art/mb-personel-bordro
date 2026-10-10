"use client";

import { useActionState, useEffect } from "react";
import { signIn, type LoginState } from "./actions";

export function LoginForm({ next, staff = false }: { next: string; staff?: boolean }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(signIn, {});
  // Personel: oturum bordro uygulamasına aktarılır, kişi kendi ekranına geçer
  useEffect(() => {
    if (state.handoff) window.location.replace(state.handoff);
  }, [state.handoff]);
  const busy = pending || !!state.handoff;
  return (
    <form action={action} className="mt-8 space-y-4">
      <input type="hidden" name="sonra" value={next} />
      {staff && <input type="hidden" name="hedef" value="personel" />}
      <label className="block text-sm font-medium text-slate">
        {staff ? "Personel no (PDKS) ya da e-posta" : "E-posta (personel için personel no)"}
        <input name="email" type="text" inputMode={staff ? "text" : "email"} autoComplete="username" autoCapitalize="none" spellCheck={false} required className="field mt-1.5" />
      </label>
      <label className="block text-sm font-medium text-slate">
        Şifre
        <input name="password" type="password" autoComplete="current-password" required className="field mt-1.5" />
      </label>
      {state.error && (
        <p role="alert" className="rounded-lg bg-bad-bg px-3 py-2 text-sm text-bad">
          {state.error}
        </p>
      )}
      <button type="submit" disabled={busy} className="w-full rounded-full bg-navy py-3 font-semibold text-white hover:bg-blue disabled:opacity-60">
        {state.handoff ? "Personel ekranınız açılıyor…" : pending ? "Giriş yapılıyor…" : staff ? "Personel ekranıma gir" : "Giriş yap"}
      </button>
    </form>
  );
}
