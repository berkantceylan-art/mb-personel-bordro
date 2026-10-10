import Link from "next/link";
import { LoginForm } from "./LoginForm";

export const metadata = { title: "Giriş" };

const ERRORS: Record<string, string> = {
  yetki: "Bu hesabın site yönetimine erişimi yok. Yetki için şirket sahibine başvurun.",
  hesap: "Hesabınız henüz bir role bağlı değil. Laboratuvarla iletişime geçin.",
  onay: "E-posta adresiniz onaylandı. Şimdi giriş yapabilirsiniz.",
  baglanti: "Onay bağlantısı geçersiz ya da süresi dolmuş. Giriş yapmayı deneyin ya da yeniden kayıt olun.",
  ayar: "Sunucu ayarları eksik: Supabase bağlantısı (NEXT_PUBLIC_SUPABASE_URL ve ANON_KEY) tanımlı değil.",
};

const DOORS = [
  { name: "Yerli hekim", note: "Türkiye'deki muayenehaneler" },
  { name: "Yurtdışı hekim", note: "Fransa ve diğer ülkeler" },
  { name: "Klinik", note: "Çok hekimli klinik ve hastaneler" },
  { name: "Aracı kuruluş", note: "Hekimlerden vaka toplayan kuruluşlar" },
  { name: "Personel", note: "Bordro, izin, avans, puantaj: kendi ekranınız" },
  { name: "Yönetim ve ERP", note: "Laboratuvar yönetimi" },
];

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ sonra?: string; hata?: string; kim?: string }> }) {
  const { sonra, hata, kim } = await searchParams;
  const staff = kim === "personel";
  const next = sonra && sonra.startsWith("/") && !sonra.startsWith("//") ? sonra : "";
  return (
    <main className="grid min-h-dvh lg:grid-cols-2">
      <section className="flex flex-col bg-navy px-6 py-10 text-white sm:px-12">
        <Link href="/tr" className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.svg" alt="" width={44} height={44} className="h-11 w-11" />
          <span className="display text-2xl font-semibold">MB Dental</span>
        </Link>
        <div className="my-auto max-w-md py-12">
          <h1 className="display text-4xl font-semibold leading-tight sm:text-5xl">Tek giriş, herkes kendi paneline.</h1>
          <p className="mt-4 text-white/70">Hesabınızın türünü seçmenize gerek yok; girişten sonra size ait ekrana yönlendirilirsiniz.</p>
          <ul className="mt-8 space-y-3">
            {DOORS.map((d) => (
              <li key={d.name} className="flex items-baseline justify-between gap-4 border-b border-white/10 pb-3">
                <span className="font-semibold">{d.name}</span>
                <span className="text-right text-sm text-white/55">{d.note}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>
      <section className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">
          <div role="tablist" aria-label="Giriş türü" className="mb-6 grid grid-cols-2 rounded-full bg-gypsum/60 p-1 text-sm font-semibold">
            <Link role="tab" aria-selected={!staff} href={next ? `/giris?sonra=${encodeURIComponent(next)}` : "/giris"} className={`rounded-full px-4 py-2 text-center ${!staff ? "bg-white text-navy shadow-sm" : "text-slate hover:text-navy"}`}>
              Hekim / yönetim
            </Link>
            <Link role="tab" aria-selected={staff} href="/giris?kim=personel" className={`rounded-full px-4 py-2 text-center ${staff ? "bg-white text-navy shadow-sm" : "text-slate hover:text-navy"}`}>
              Personel
            </Link>
          </div>
          <h2 className="display text-3xl font-semibold text-navy">{staff ? "Personel girişi" : "Giriş yap"}</h2>
          {staff && <p className="mt-2 text-sm text-slate">Bordro, izin, avans, puantaj ve belgeleriniz için kendi ekranınıza geçersiniz. Bordro uygulamasındaki kullanıcı adı ve şifrenizi kullanın.</p>}
          {hata && ERRORS[hata] && <p className="mt-4 rounded-lg bg-warn-bg px-3 py-2 text-sm text-warn">{ERRORS[hata]}</p>}
          <LoginForm key={staff ? "personel" : "genel"} next={next} staff={staff} />
          {!staff && (
          <div className="mt-8 rounded-2xl border border-gypsum bg-white p-5">
            <p className="font-semibold text-navy">Hesabınız yok mu?</p>
            <p className="mt-1 text-sm text-slate">Hekim, klinik ve aracı kuruluşlar portal hesabı açıp vakalarını çevrim içi gönderebilir.</p>
            <div className="mt-3 flex flex-wrap gap-3 text-sm font-semibold">
              <Link href="/portal/kayit?dil=tr" className="rounded-full bg-navy px-4 py-2 text-white hover:bg-blue">
                Hesap açın
              </Link>
              <Link href="/portal/kayit?dil=en" className="rounded-full border border-gypsum px-4 py-2 text-navy hover:border-navy">
                Open an account
              </Link>
              <Link href="/portal/kayit?dil=fr" className="rounded-full border border-gypsum px-4 py-2 text-navy hover:border-navy">
                Créer un compte
              </Link>
            </div>
          </div>
          )}
          {staff && process.env.NEXT_PUBLIC_ERP_URL && (
            <p className="mt-6 text-sm text-slate">
              İlk kez mi giriyorsunuz?{" "}
              <a href={`${process.env.NEXT_PUBLIC_ERP_URL.replace(/\/+$/, "")}/davet`} className="font-semibold text-blue hover:underline">
                Davet kodumla hesap oluştur
              </a>
            </p>
          )}
        </div>
      </section>
    </main>
  );
}
