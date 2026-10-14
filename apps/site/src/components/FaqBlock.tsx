import type { Faq } from "@/lib/cms";
import { t, type Locale } from "@/lib/i18n";

const TITLE = { tr: "Sık sorulan sorular", en: "Frequently asked questions", fr: "Questions fréquentes" } as const;

/** Sayfa içi soru-cevap (açılır; cevap HTML'de hazır, botlar okuyabilir) */
export function FaqBlock({ faqs, locale, title }: { faqs: Faq[]; locale: Locale; title?: string }) {
  if (!faqs.length) return null;
  return (
    <section aria-labelledby="sayfa-sss" className="border-t border-gypsum bg-white">
      <div className="mx-auto max-w-4xl px-4 py-16 sm:px-6">
        <h2 id="sayfa-sss" className="display text-2xl font-semibold text-navy">{title ?? TITLE[locale]}</h2>
        <div className="mt-6 divide-y divide-gypsum rounded-2xl border border-gypsum">
          {faqs.map((f) => (
            <details key={f.id} className="group p-5" open>
              <summary className="cursor-pointer list-none text-lg font-semibold text-ink">
                <span className="mr-2 text-smile-ink">?</span>{t(f.question, locale)}
              </summary>
              <p className="mt-2 whitespace-pre-line leading-relaxed text-slate">{t(f.answer, locale)}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
