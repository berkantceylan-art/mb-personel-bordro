import Link from "next/link";
import { LoginForm } from "./LoginForm";

export const metadata = { title: "Giriş" };

const ERRORS: Record<string, string> = {
  yetki: "Bu hesabın site yönetimine erişimi yok. Yetki için şirket sahibine başvurun.",
  hesap: "Hesabınız henüz bir role bağlı değil. Laboratuvarla iletişime geçin.",
  ayar: "Sunucu ayarları eksik: Supabase bağlantısı (NEXT_PUBLIC_SUPABASE_URL ve ANON_KEY) tanımlı değil.",
};

const DOORS = [
  { name: "Yerli hekim", note: "Türkiye'deki muayenehaneler" },
  { name: "Yurtdışı hekim", note: "Fransa ve diğer ülkeler" },
  { name: "Klinik", note: "Çok hekimli klinik ve hastaneler" },
  { name: "Aracı kuruluş", note: "Hekimlerden vaka toplayan kuruluşlar" },
  { name: "Personel ve ERP", note: "Laboratuvar ekibi ve yönetim" },
];

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ sonra?: string; hata?: string }> }) {
  const { sonra, hata } = await searchParams;
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
          <h2 className="display text-3xl font-semibold text-navy">Giriş yap</h2>
          {hata && ERRORS[hata] && <p className="mt-4 rounded-lg bg-warn-bg px-3 py-2 text-sm text-warn">{ERRORS[hata]}</p>}
          <LoginForm next={next} />
          <p className="mt-6 text-sm text-slate">
            Hesabınız yok mu? Hekim, klinik ve aracı kuruluş başvuruları portal açıldığında buradan alınacak. Şimdilik{" "}
            <a href="mailto:info@mbdentaire.com" className="font-semibold text-navy underline-offset-4 hover:underline">
              info@mbdentaire.com
            </a>{" "}
            adresine yazın.
          </p>
        </div>
      </section>
    </main>
  );
}
