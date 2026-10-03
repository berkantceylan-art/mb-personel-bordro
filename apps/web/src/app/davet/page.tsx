"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { PERSONNEL_DOMAIN } from "@/lib/constants";

type Preview = { company: string; role: string; display_name: string | null; login_email: string; valid: boolean };
const input = "h-12 rounded-lg border border-line px-3 text-ink text-base";

export default function InvitePage() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function check(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { data, error } = await createClient().rpc("invite_preview", { p_code: code });
    setBusy(false);
    const p = data as Preview | null;
    if (error || !p) return setError("Davet kodu bulunamadı.");
    if (!p.valid) return setError("Bu davet kodu kullanılmış ya da süresi dolmuş.");
    setPreview(p);
  }

  async function register(e: React.FormEvent) {
    e.preventDefault();
    if (!preview) return;
    if (password.length < 6) return setError("Şifre en az 6 karakter olmalı.");
    if (password !== password2) return setError("Şifreler aynı değil.");
    setBusy(true);
    setError(null);
    const supabase = createClient();
    // 1) Sunucu hesabı hazırlar (e-posta onayı gerekmez, yarım kalan denemeyi düzeltir)
    const res = await fetch("/api/davet", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code, password }) });
    let error: { message: string } | null = null;
    if (res.status === 501) {
      // Sunucu servisi ayarlı değilse eski yol
      ({ error } = await supabase.auth.signUp({ email: preview.login_email, password }));
      if (error && /registered|exists/i.test(error.message)) error = null;
    } else if (!res.ok) {
      error = { message: ((await res.json().catch(() => ({}))) as { error?: string }).error ?? "Hesap oluşturulamadı" };
    }
    if (!error) ({ error } = await supabase.auth.signInWithPassword({ email: preview.login_email, password }));
    if (error) {
      setBusy(false);
      return setError(/invalid login/i.test(error.message) ? "Bu kullanıcı adıyla daha önce farklı bir şifreyle hesap açılmış. Yöneticinize bildirin." : error.message);
    }
    const { error: claimErr } = await supabase.rpc("claim_invite", { p_code: code });
    setBusy(false);
    if (claimErr) return setError(claimErr.message);
    router.replace(preview.role === "employee" ? "/benim" : "/");
    router.refresh();
  }

  const login = preview ? (preview.login_email.endsWith(`@${PERSONNEL_DOMAIN}`) ? preview.login_email.split("@")[0] : preview.login_email) : "";

  return (
    <main className="min-h-screen grid place-items-center bg-brand-900 px-4">
      <div className="w-full max-w-sm bg-white rounded-2xl p-8 flex flex-col gap-5 shadow-xl">
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="MB Dental logosu" className="w-12 h-11 object-contain" />
          <div>
            <h1 className="font-display font-bold text-lg text-brand-800">Hesap oluştur</h1>
            <p className="text-sm text-muted">Size verilen davet koduyla</p>
          </div>
        </div>
        {!preview ? (
          <form onSubmit={check} className="flex flex-col gap-4">
            <label className="flex flex-col gap-1.5 text-sm text-muted">Davet kodu
              <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} required maxLength={12} autoCapitalize="characters" className={`${input} font-mono tracking-[0.25em] text-lg`} />
            </label>
            {error && <p className="text-sm text-bad bg-bad-bg rounded-lg px-3 py-2">{error}</p>}
            <button disabled={busy} className="h-12 rounded-lg bg-brand-700 text-white font-semibold disabled:opacity-60">{busy ? "Kontrol ediliyor…" : "Devam"}</button>
          </form>
        ) : (
          <form onSubmit={register} className="flex flex-col gap-4">
            <div className="rounded-lg bg-[#F3F6F9] p-3 text-sm">
              <div className="font-semibold text-ink">{preview.display_name ?? "Hoş geldiniz"}</div>
              <div className="text-muted">{preview.company}</div>
              <div className="mt-1">Kullanıcı adınız: <b className="font-mono">{login}</b></div>
            </div>
            <label className="flex flex-col gap-1.5 text-sm text-muted">Şifre belirleyin
              <input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required className={input} />
            </label>
            <label className="flex flex-col gap-1.5 text-sm text-muted">Şifre (tekrar)
              <input type="password" autoComplete="new-password" value={password2} onChange={(e) => setPassword2(e.target.value)} required className={input} />
            </label>
            {error && <p className="text-sm text-bad bg-bad-bg rounded-lg px-3 py-2">{error}</p>}
            <button disabled={busy} className="h-12 rounded-lg bg-brand-700 text-white font-semibold disabled:opacity-60">{busy ? "Oluşturuluyor…" : "Hesabı oluştur"}</button>
          </form>
        )}
      </div>
    </main>
  );
}
