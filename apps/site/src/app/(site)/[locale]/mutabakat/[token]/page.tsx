import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SiteFooter, SiteHeader } from "@/components/SiteChrome";
import { isLocale } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";
import { RECON, reconDate, reconLang, reconMoney } from "@/lib/recon-text";
import { respondReconciliation } from "@/lib/recon-actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

type R = { party: string; as_of: string; balance: number; currency: string; status: string; company: string; responded_at: string | null; their_balance: number | null; lang: string };
const ERR: Record<string, Record<string, string>> = {
  ad: { tr: "Adınızı yazın.", en: "Please enter your name.", fr: "Veuillez saisir votre nom." },
  not: { tr: "İtiraz için açıklama ya da bakiyenizi yazın.", en: "Please add a comment or your balance.", fr: "Ajoutez un commentaire ou votre solde." },
  hata: { tr: "Kaydedilemedi, tekrar deneyin.", en: "Could not be saved, please try again.", fr: "Échec de l’enregistrement, réessayez." },
};

/** Cari mutabakat: bağlantıyla onay / itiraz */
export default async function ReconPublic({ params, searchParams }: { params: Promise<{ locale: string; token: string }>; searchParams: Promise<{ s?: string }> }) {
  const { locale, token } = await params;
  if (!isLocale(locale) || !/^[0-9a-f]{24,80}$/.test(token)) notFound();
  const sp = await searchParams;
  const supabase = await createClient();
  const { data } = await supabase.rpc("fin_recon_public", { p_token: token });
  if (!data) notFound();
  const r = data as R;
  const lang = reconLang(locale);
  const t = RECON[lang];
  const bal = Number(r.balance);
  const open = r.status === "sent";

  return (
    <>
      <SiteHeader locale={locale} altPath={`/mutabakat/${token}`} />
      <main className="mx-auto max-w-2xl px-4 py-16 sm:px-6">
        <p className="text-sm font-semibold text-slate">{r.company}</p>
        <h1 className="display mt-1 text-4xl font-semibold text-navy">{t.title}</h1>
        <p className="mt-6 text-lg font-semibold">{r.party}</p>
        <p className="mt-2 leading-relaxed text-slate">{t.intro(r.company, reconDate(r.as_of, lang))}</p>
        <div className="mt-6 flex items-center justify-between rounded-3xl border border-gypsum bg-white p-6">
          <span className="text-slate">{bal > 0 ? t.owe_us : bal < 0 ? t.we_owe : t.zero}</span>
          <b className="display num text-3xl text-navy">{reconMoney(bal, r.currency, lang)}</b>
        </div>
        {sp.s === "confirmed" && <p className="mt-6 rounded-2xl bg-porcelain p-4 font-semibold text-navy">{t.thanks_ok}</p>}
        {sp.s === "disputed" && <p className="mt-6 rounded-2xl bg-porcelain p-4 font-semibold text-navy">{t.thanks_dispute}</p>}
        {sp.s && ERR[sp.s] && <p role="alert" className="mt-6 rounded-2xl bg-[#FDECEA] p-4 font-semibold text-[#9B1C14]">{ERR[sp.s]![lang]}</p>}
        {!open && !["confirmed", "disputed"].includes(sp.s ?? "") && r.responded_at && <p className="mt-6 text-slate">{t.already(r.status, reconDate(r.responded_at, lang))}</p>}
        {open && (
          <form action={respondReconciliation} className="mt-8 grid gap-4 rounded-3xl border border-gypsum bg-white p-6">
            <input type="hidden" name="token" value={token} />
            <input type="hidden" name="locale" value={lang} />
            <p className="text-slate">{t.ask}</p>
            <label className="grid gap-1 text-sm font-semibold text-navy">{t.name}<input name="name" required maxLength={120} className="field" autoComplete="name" /></label>
            <label className="grid gap-1 text-sm font-semibold text-navy">{t.their}<input name="their" inputMode="decimal" maxLength={30} className="field" placeholder={reconMoney(bal, r.currency, lang)} /></label>
            <label className="grid gap-1 text-sm font-semibold text-navy">{t.note}<textarea name="note" rows={3} maxLength={1000} className="field" /></label>
            <div className="flex flex-wrap gap-3">
              <button name="status" value="confirmed" className="rounded-full bg-navy px-6 py-3 font-semibold text-white hover:bg-blue">✓ {t.confirm}</button>
              <button name="status" value="disputed" className="rounded-full border border-gypsum bg-white px-6 py-3 font-semibold text-navy hover:border-navy">{t.dispute}</button>
            </div>
            <p className="text-xs text-slate">{t.footer}</p>
          </form>
        )}
      </main>
      <SiteFooter locale={locale} />
    </>
  );
}
