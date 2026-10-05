import Link from "next/link";
import { redirect } from "next/navigation";
import { LOCALES, LOCALE_NAMES, isLocale, type Locale } from "@/lib/i18n";
import { PORTAL_UI, portalContext, portalLocale } from "@/lib/portal";
import { SignUpForm } from "./SignUpForm";

export const metadata = {
  title: "Hekim portalına kayıt",
  description: "Hekim, klinik ve aracı kuruluşlar için MB Dental portalı: çevrim içi vaka gönderme, dosya yükleme, aşama aşama takip ve fiyat listesi.",
};

export default async function SignUpPage({ searchParams }: { searchParams: Promise<{ dil?: string }> }) {
  const { dil } = await searchParams;
  const ctx = await portalContext();
  if (ctx) redirect("/portal");
  const locale: Locale = isLocale(dil) ? dil : await portalLocale();
  const ui = PORTAL_UI[locale];
  return (
    <main lang={locale} className="grid min-h-dvh lg:grid-cols-[1fr_1.2fr]">
      <section className="flex flex-col bg-navy px-6 py-10 text-white sm:px-12">
        <Link href={`/${locale}`} className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.svg" alt="" width={44} height={44} className="h-11 w-11" />
          <span className="display text-2xl font-semibold">MB Dental</span>
        </Link>
        <div className="my-auto max-w-md py-12">
          <p className="text-sm font-semibold uppercase tracking-wider text-smile">{ui.title}</p>
          <h1 className="display mt-3 text-4xl font-semibold leading-tight sm:text-5xl">{ui.signup.title}</h1>
          <p className="mt-4 text-lg text-white/75">{ui.signup.lead}</p>
        </div>
        <nav aria-label={ui.signup.language} className="flex gap-2 text-sm">
          {LOCALES.map((l) => (
            <Link
              key={l}
              href={`/portal/kayit?dil=${l}`}
              hrefLang={l}
              aria-current={l === locale ? "true" : undefined}
              className={`rounded-full px-3 py-1.5 ${l === locale ? "bg-white/15 text-white" : "text-white/60 hover:text-white"}`}
            >
              {LOCALE_NAMES[l]}
            </Link>
          ))}
        </nav>
      </section>
      <section className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-xl">
          <SignUpForm locale={locale} />
          <p className="mt-6 text-sm text-slate">
            {ui.signup.haveAccount}{" "}
            <Link href="/giris?sonra=/portal" className="font-semibold text-navy underline-offset-4 hover:underline">
              {ui.signup.login}
            </Link>
          </p>
        </div>
      </section>
    </main>
  );
}
