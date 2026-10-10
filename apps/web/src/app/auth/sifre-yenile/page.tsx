"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

const input = "h-12 rounded-lg border border-line px-3 text-ink text-base";

function passwordMessage(m: string): string {
  const len = /at least (\d+) characters/i.exec(m)?.[1];
  if (len) return `Şifre en az ${len} karakter olmalı.`;
  if (/one character of each/i.test(m)) return "Şifre büyük harf, küçük harf ve rakam içermeli (gerekiyorsa sembol de).";
  if (/weak|easy to guess|pwned|leaked/i.test(m)) return "Bu şifre çok yaygın ya da daha önce sızdırılmış. Daha güçlü bir şifre seçin.";
  if (/different from the old/i.test(m)) return "Yeni şifre eskisinden farklı olmalı.";
  return "Şifre kaydedilemedi. Lütfen tekrar deneyin.";
}

/** E-postadaki şifre yenileme bağlantısının açıldığı sayfa */
export default function ResetPasswordPage() {
  const [ready, setReady] = useState<"wait" | "ok" | "bad">("wait");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    // İstemci, adresteki ?code / #access_token bilgisini açılışta kendisi oturuma çevirir
    supabase.auth.getSession().then(async ({ data }) => {
      if (data.session) return setReady("ok");
      const code = new URLSearchParams(window.location.search).get("code");
      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        return setReady(error ? "bad" : "ok");
      }
      setReady("bad");
    });
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 6) return setError("Şifre en az 6 karakter olmalı.");
    if (password !== password2) return setError("Şifreler aynı değil.");
    setBusy(true);
    setError(null);
    const { error } = await createClient().auth.updateUser({ password });
    setBusy(false);
    if (error) return setError(passwordMessage(error.message));
    window.location.replace("/");
  }

  return (
    <main className="min-h-screen grid place-items-center bg-brand-900 px-4">
      <div className="w-full max-w-sm bg-white rounded-2xl p-8 flex flex-col gap-5 shadow-xl">
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.svg" alt="MB Dental logosu" className="w-12 h-12 object-contain" />
          <h1 className="font-display font-bold text-lg text-brand-800">Yeni şifre belirleyin</h1>
        </div>
        {ready === "wait" && <p className="text-muted">Bağlantı kontrol ediliyor…</p>}
        {ready === "bad" && (
          <>
            <p className="text-sm text-bad bg-bad-bg rounded-lg px-3 py-2">Bağlantı geçersiz ya da süresi dolmuş. Bağlantıyı istediğiniz tarayıcıda açtığınızdan emin olun ya da yeniden isteyin.</p>
            <Link href="/sifre" className="h-12 grid place-items-center rounded-lg bg-brand-700 text-white font-semibold">Yeniden iste</Link>
          </>
        )}
        {ready === "ok" && (
          <form onSubmit={save} className="flex flex-col gap-4">
            <label className="flex flex-col gap-1.5 text-sm text-muted">Yeni şifre
              <input type="password" autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)} className={input} />
            </label>
            <label className="flex flex-col gap-1.5 text-sm text-muted">Yeni şifre (tekrar)
              <input type="password" autoComplete="new-password" required value={password2} onChange={(e) => setPassword2(e.target.value)} className={input} />
            </label>
            {error && <p className="text-sm text-bad bg-bad-bg rounded-lg px-3 py-2">{error}</p>}
            <button disabled={busy} className="h-12 rounded-lg bg-brand-700 text-white font-semibold disabled:opacity-60">{busy ? "Kaydediliyor…" : "Şifreyi kaydet"}</button>
          </form>
        )}
      </div>
    </main>
  );
}
