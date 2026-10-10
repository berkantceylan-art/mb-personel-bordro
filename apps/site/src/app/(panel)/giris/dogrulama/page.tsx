import Link from "next/link";
import { Verify } from "./Verify";

export const metadata = { title: "İki adımlı doğrulama" };

export default async function MfaPage({ searchParams }: { searchParams: Promise<{ sonra?: string }> }) {
  const { sonra } = await searchParams;
  const next = sonra && sonra.startsWith("/") && !sonra.startsWith("//") ? sonra : "/admin";
  return (
    <main className="grid min-h-dvh place-items-center bg-porcelain px-4">
      <div className="w-full max-w-sm rounded-3xl bg-white p-8">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.svg" alt="" width={44} height={44} className="h-11 w-11" />
        <h1 className="display mt-4 text-2xl font-semibold text-navy">İki adımlı doğrulama</h1>
        <p className="mt-1 text-sm text-slate">Telefonunuzdaki doğrulayıcı uygulamada (Google Authenticator, Microsoft Authenticator…) MB Dental için görünen kodu yazın.</p>
        <Verify next={next} />
        <Link href="/giris" className="mt-6 block text-center text-sm font-semibold text-slate hover:text-navy">Başka hesapla giriş</Link>
      </div>
    </main>
  );
}
