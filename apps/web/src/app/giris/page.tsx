"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { PERSONNEL_DOMAIN } from "@/lib/constants";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const login = email.includes("@") ? email.trim() : `${email.trim().toLowerCase()}@${PERSONNEL_DOMAIN}`;
    const { error } = await supabase.auth.signInWithPassword({ email: login, password });
    setBusy(false);
    if (error) {
      setError("Kullanıcı adı / e-posta veya şifre hatalı.");
      return;
    }
    router.replace("/");
    router.refresh();
  }

  return (
    <main className="min-h-screen grid place-items-center bg-brand-900 px-4">
      <form onSubmit={onSubmit} className="w-full max-w-sm bg-white rounded-2xl p-8 flex flex-col gap-5 shadow-xl">
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.svg" alt="MB Dental logosu" className="w-12 h-12 object-contain" />
          <div>
            <h1 className="font-display font-bold text-lg text-brand-800">MB DENTAL</h1>
            <p className="text-sm text-muted">Personel &amp; Bordro</p>
          </div>
        </div>
        <label className="flex flex-col gap-1.5 text-sm text-muted">
          E-posta veya kullanıcı adı (PDKS no)
          <input
            type="text"
            required
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="h-12 rounded-lg border border-line px-3 text-ink text-base"
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm text-muted">
          Şifre
          <input
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="h-12 rounded-lg border border-line px-3 text-ink text-base"
          />
        </label>
        {error && <p className="text-sm text-bad bg-bad-bg rounded-lg px-3 py-2">{error}</p>}
        <button disabled={busy} className="h-12 rounded-lg bg-brand-700 text-white font-semibold disabled:opacity-60">
          {busy ? "Giriş yapılıyor…" : "Giriş yap"}
        </button>
        <Link href="/davet" className="text-center text-sm text-brand-700 font-semibold">Davet kodum var · hesap oluştur</Link>
      </form>
    </main>
  );
}
