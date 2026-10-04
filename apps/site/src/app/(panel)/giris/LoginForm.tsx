"use client";

import { useActionState } from "react";
import { signIn, type LoginState } from "./actions";

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(signIn, {});
  return (
    <form action={action} className="mt-8 space-y-4">
      <input type="hidden" name="sonra" value={next} />
      <label className="block text-sm font-medium text-slate">
        E-posta
        <input name="email" type="email" autoComplete="email" required className="field mt-1.5" />
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
      <button type="submit" disabled={pending} className="w-full rounded-full bg-navy py-3 font-semibold text-white hover:bg-blue disabled:opacity-60">
        {pending ? "Giriş yapılıyor…" : "Giriş yap"}
      </button>
    </form>
  );
}
