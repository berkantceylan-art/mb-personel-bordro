import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SiteFooter, SiteHeader } from "@/components/SiteChrome";
import { isLocale } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";
import { SURVEY, svLang } from "@/lib/survey-text";
import { answerSurvey } from "@/lib/survey-actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

const FACES = ["😞", "🙁", "😐", "🙂", "😍"];

/** Memnuniyet anketi: tek dokunuşla puan */
export default async function SurveyPublic({ params, searchParams }: { params: Promise<{ locale: string; token: string }>; searchParams: Promise<{ s?: string }> }) {
  const { locale, token } = await params;
  if (!isLocale(locale) || !/^[0-9a-f]{24,80}$/.test(token)) notFound();
  const sp = await searchParams;
  const supabase = await createClient();
  const { data } = await supabase.rpc("srv_public", { p_token: token });
  if (!data) notFound();
  const r = data as { customer: string; job_no: number; patient: string | null; answered: boolean; company: string };
  const t = SURVEY[svLang(locale)];

  return (
    <>
      <SiteHeader locale={locale} altPath={`/anket/${token}`} />
      <main className="mx-auto max-w-xl px-4 py-16 sm:px-6">
        <p className="text-sm font-semibold text-slate">{r.company}</p>
        <h1 className="display mt-1 text-4xl font-semibold text-navy">{t.title}</h1>
        {sp.s === "ok" && <p className="mt-8 rounded-2xl bg-porcelain p-5 text-lg font-semibold text-navy">{t.thanks}</p>}
        {sp.s === "dusuk" && <p className="mt-8 rounded-2xl bg-porcelain p-5 text-lg font-semibold text-navy">{t.low}</p>}
        {!sp.s && r.answered && <p className="mt-8 text-slate">{t.already}</p>}
        {!sp.s && !r.answered && (
          <form action={answerSurvey} className="mt-8 grid gap-6 rounded-3xl border border-gypsum bg-white p-6">
            <input type="hidden" name="token" value={token} />
            <input type="hidden" name="locale" value={locale} />
            <p className="text-lg font-semibold text-navy">{r.customer}, {t.q(r.job_no, r.patient ?? "")}</p>
            <div className="grid grid-cols-5 gap-2">
              {FACES.map((f, i) => (
                <label key={i} className="cursor-pointer text-center">
                  <input type="radio" name="score" value={i + 1} required className="peer sr-only" />
                  <span className="block rounded-2xl border-2 border-gypsum p-3 text-4xl transition peer-checked:border-navy peer-checked:bg-porcelain">{f}</span>
                  <span className="mt-1 block text-[11px] leading-tight text-slate">{t.scores[i]}</span>
                </label>
              ))}
            </div>
            <label className="grid gap-1 text-sm font-semibold text-navy">{t.comment}<textarea name="comment" rows={3} maxLength={1000} className="field" /></label>
            <button className="justify-self-start rounded-full bg-navy px-6 py-3 font-semibold text-white hover:bg-blue">{t.send}</button>
          </form>
        )}
      </main>
      <SiteFooter locale={locale} />
    </>
  );
}
