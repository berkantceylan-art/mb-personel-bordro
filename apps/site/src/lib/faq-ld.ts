import type { Faq } from "./cms";
import { t, type Locale } from "./i18n";

/** FAQPage şeması (Google ve yapay zekâ cevaplarında soru-cevap olarak görünür) */
export function faqJsonLd(faqs: Faq[], locale: Locale) {
  if (!faqs.length) return null;
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((f) => ({ "@type": "Question", name: t(f.question, locale), acceptedAnswer: { "@type": "Answer", text: t(f.answer, locale) } })),
  };
}
