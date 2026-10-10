"use client";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

/** İki adımlı doğrulama: doğrulayıcı uygulamadaki 6 haneli kod */
export function Verify({ next }: { next: string }) {
  const [code, setCode] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const supabase = createClient();
    const { data: f } = await supabase.auth.mfa.listFactors();
    const factor = f?.totp?.find((x) => x.status === "verified");
    if (!factor) {
      setBusy(false);
      return setErr("Doğrulayıcı bulunamadı. Yöneticiye başvurun.");
    }
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code: code.replace(/\s/g, "") });
    setBusy(false);
    if (error) return setErr("Kod hatalı ya da süresi geçti. Uygulamadaki güncel kodu yazın.");
    window.location.replace(next);
  }

  return (
    <form onSubmit={submit} className="mt-6 grid gap-4">
      <label className="grid gap-1.5 text-sm font-semibold text-navy">
        6 haneli kod
        <input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" maxLength={7} autoFocus required className="field num text-center text-2xl tracking-[0.4em]" />
      </label>
      {err && <p role="alert" className="rounded-lg bg-bad-bg px-3 py-2 text-sm text-bad">{err}</p>}
      <button disabled={busy} className="rounded-full bg-navy py-3 font-semibold text-white hover:bg-blue disabled:opacity-60">{busy ? "Doğrulanıyor…" : "Doğrula"}</button>
    </form>
  );
}
