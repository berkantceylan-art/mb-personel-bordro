"use client";
import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

const input = "h-12 rounded-lg border border-line px-3 text-ink text-base";

/**
 * Şifremi unuttum.
 * - Personel no (PDKS) ile girenlerin e-postası yoktur: İK'dan sıfırlama kodu alıp /davet ekranında yeni şifre belirlerler.
 * - E-postayla girenlere Supabase şifre yenileme bağlantısı gönderilir (/auth/sifre-yenile).
 */
export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const value = email.trim();
    if (!value.includes("@")) return setError("Personel numarasıyla giriyorsanız yukarıdaki yolu kullanın: İK'dan sıfırlama kodu isteyin.");
    setBusy(true);
    setError(null);
    const { error } = await createClient().auth.resetPasswordForEmail(value, { redirectTo: `${window.location.origin}/auth/sifre-yenile` });
    setBusy(false);
    if (error && /rate|seconds|too many/i.test(error.message)) return setError("Çok sık istek gönderildi. Birkaç dakika sonra tekrar deneyin.");
    // Hesap var mı yok mu belli etmemek için her durumda aynı mesaj
    setSent(true);
  }

  return (
    <main className="min-h-screen grid place-items-center bg-brand-900 px-4">
      <div className="w-full max-w-sm bg-white rounded-2xl p-8 flex flex-col gap-5 shadow-xl">
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.svg" alt="MB Dental logosu" className="w-12 h-12 object-contain" />
          <div>
            <h1 className="font-display font-bold text-lg text-brand-800">Şifremi unuttum</h1>
            <p className="text-sm text-muted">Personel &amp; Bordro</p>
          </div>
        </div>

        <section className="rounded-lg bg-[#F3F6F9] p-4 text-sm flex flex-col gap-2">
          <h2 className="font-semibold text-ink">Personel numarasıyla giriyorsanız</h2>
          <p className="text-muted">Yöneticinizden (İK) <b>şifre sıfırlama kodu</b> isteyin. Kodu girip aynı kullanıcı adıyla yeni şifrenizi belirlersiniz.</p>
          <Link href="/davet" className="h-11 grid place-items-center rounded-lg bg-brand-700 text-white font-semibold">Kodum var · yeni şifre belirle</Link>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="font-semibold text-ink text-sm">E-posta adresinizle giriyorsanız</h2>
          {sent ? (
            <p className="text-sm text-ok bg-ok-bg rounded-lg px-3 py-2">Bu adrese kayıtlı bir hesap varsa şifre yenileme bağlantısı gönderildi. E-postanızı (gereksiz klasörü dahil) kontrol edin.</p>
          ) : (
            <form onSubmit={send} className="flex flex-col gap-3">
              <input type="email" required autoComplete="email" placeholder="ornek@mbdental.com" value={email} onChange={(e) => setEmail(e.target.value)} className={input} />
              {error && <p className="text-sm text-bad bg-bad-bg rounded-lg px-3 py-2">{error}</p>}
              <button disabled={busy} className="h-11 rounded-lg border border-line font-semibold text-brand-700 disabled:opacity-60">{busy ? "Gönderiliyor…" : "Yenileme bağlantısı gönder"}</button>
            </form>
          )}
        </section>

        <Link href="/giris" className="text-center text-sm text-brand-700 font-semibold">Giriş ekranına dön</Link>
      </div>
    </main>
  );
}
