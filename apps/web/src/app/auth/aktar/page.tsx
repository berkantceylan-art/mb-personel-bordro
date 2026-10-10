"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

/**
 * Web sitesinden (mbdentaire.com/giris) gelen personel girişini devralır.
 * Site, giriş sonrası bu uygulama için AYRI bir oturum açar ve anahtarları
 * adres çubuğunun # kısmında gönderir (# kısmı sunucuya ve kayıtlara gitmez).
 * Burada oturum kurulur, adres temizlenir ve kişi kendi ekranına geçer.
 */
export default function SessionHandoffPage() {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.slice(1));
    // Anahtarlar tarayıcı geçmişinde kalmasın
    window.history.replaceState(null, "", window.location.pathname);
    const access_token = params.get("access_token") ?? "";
    const refresh_token = params.get("refresh_token") ?? "";
    const next = params.get("sonra") ?? "/";
    const target = next.startsWith("/") && !next.startsWith("//") ? next : "/";
    if (!access_token || !refresh_token) {
      setFailed(true);
      return;
    }
    const supabase = createClient();
    supabase.auth.setSession({ access_token, refresh_token }).then(({ error }) => {
      if (error) setFailed(true);
      else window.location.replace(target);
    });
  }, []);

  return (
    <main className="min-h-screen grid place-items-center bg-brand-900 px-4">
      <div className="w-full max-w-sm bg-white rounded-2xl p-8 flex flex-col gap-4 shadow-xl text-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.svg" alt="MB Dental logosu" className="w-12 h-12 object-contain mx-auto" />
        {failed ? (
          <>
            <p className="text-ink font-semibold">Oturum aktarılamadı.</p>
            <p className="text-sm text-muted">Bağlantının süresi dolmuş olabilir. Lütfen tekrar giriş yapın.</p>
            <Link href="/giris" className="h-12 grid place-items-center rounded-lg bg-brand-700 text-white font-semibold">
              Giriş ekranı
            </Link>
          </>
        ) : (
          <p className="text-muted">Personel ekranınız açılıyor…</p>
        )}
      </div>
    </main>
  );
}
