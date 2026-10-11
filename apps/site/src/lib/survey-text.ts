/** Memnuniyet anketi metinleri (hekimin belge dilinde) */
export type SvLang = "tr" | "en" | "fr";
export const SURVEY: Record<SvLang, { title: string; q: (job: number, patient: string) => string; scores: string[]; comment: string; send: string; thanks: string; low: string; already: string; wa: (name: string, link: string) => string }> = {
  tr: {
    title: "Memnuniyet anketi", q: (j, p) => `#${j}${p ? ` (${p})` : ""} numaralı işimizden ne kadar memnun kaldınız?`,
    scores: ["Hiç memnun değilim", "Memnun değilim", "Orta", "Memnunum", "Çok memnunum"], comment: "Eklemek istedikleriniz (isteğe bağlı)", send: "Gönder",
    thanks: "Teşekkür ederiz! Görüşünüz bize ulaştı.", low: "Üzgünüz. Kalite ekibimiz sizinle en kısa sürede iletişime geçecek.", already: "Bu anket daha önce yanıtlandı. Teşekkür ederiz.",
    wa: (n, l) => `Sayın ${n}, son işimizi 1-5 arası puanlar mısınız? Tek tıkla, 10 saniye: ${l}`,
  },
  en: {
    title: "Satisfaction survey", q: (j, p) => `How satisfied are you with case #${j}${p ? ` (${p})` : ""}?`,
    scores: ["Very dissatisfied", "Dissatisfied", "Neutral", "Satisfied", "Very satisfied"], comment: "Anything to add (optional)", send: "Send",
    thanks: "Thank you! We have received your feedback.", low: "We are sorry. Our quality team will contact you shortly.", already: "This survey has already been answered. Thank you.",
    wa: (n, l) => `Dear ${n}, could you rate our latest case from 1 to 5? One tap, 10 seconds: ${l}`,
  },
  fr: {
    title: "Enquête de satisfaction", q: (j, p) => `Quel est votre niveau de satisfaction pour le cas n° ${j}${p ? ` (${p})` : ""} ?`,
    scores: ["Très insatisfait", "Insatisfait", "Moyen", "Satisfait", "Très satisfait"], comment: "Commentaire (facultatif)", send: "Envoyer",
    thanks: "Merci ! Votre avis nous est bien parvenu.", low: "Nous sommes désolés. Notre équipe qualité vous contactera rapidement.", already: "Cette enquête a déjà reçu une réponse. Merci.",
    wa: (n, l) => `Bonjour ${n}, pourriez-vous noter notre dernier travail de 1 à 5 ? Un clic, 10 secondes : ${l}`,
  },
};
export const svLang = (l: string | null | undefined): SvLang => (l === "en" || l === "fr" ? l : "tr");
