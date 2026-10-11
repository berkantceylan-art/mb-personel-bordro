/** Cari mutabakat mektubu metinleri (müşterinin belge dilinde) */
export type ReconLang = "tr" | "en" | "fr";
export const RECON: Record<ReconLang, {
  title: string; intro: (company: string, date: string) => string; owe_us: string; we_owe: string; zero: string;
  ask: string; confirm: string; dispute: string; name: string; note: string; their: string; send: string;
  thanks_ok: string; thanks_dispute: string; already: (s: string, d: string) => string; footer: string; wa: (party: string, date: string, link: string) => string;
}> = {
  tr: {
    title: "Cari Hesap Mutabakatı",
    intro: (c, d) => `${c} kayıtlarına göre ${d} tarihi itibarıyla cari hesap bakiyeniz aşağıdaki gibidir.`,
    owe_us: "Borç bakiyeniz", we_owe: "Alacak bakiyeniz", zero: "Bakiye yoktur",
    ask: "Kayıtlarınızla karşılaştırıp mutabık olup olmadığınızı bildirmenizi rica ederiz.",
    confirm: "Mutabıkız", dispute: "Mutabık değiliz", name: "Adınız soyadınız", note: "Açıklama (fark varsa nedeni)", their: "Sizin kayıtlarınızdaki bakiye",
    send: "Gönder", thanks_ok: "Teşekkür ederiz, mutabakatınız kaydedildi.", thanks_dispute: "Teşekkür ederiz, itirazınız iletildi; sizinle iletişime geçeceğiz.",
    already: (s, d) => `Bu mutabakat ${d} tarihinde ${s === "confirmed" ? "onaylandı" : "itiraz edildi"}.`,
    footer: "Bu mektuba 15 gün içinde yanıt verilmemesi halinde bakiye mutabık kabul edilecektir.",
    wa: (p, d, l) => `Sayın ${p}, ${d} tarihli cari hesap mutabakatınızı aşağıdaki bağlantıdan görüp onaylayabilirsiniz: ${l}`,
  },
  en: {
    title: "Account Balance Confirmation",
    intro: (c, d) => `According to the records of ${c}, your account balance as of ${d} is shown below.`,
    owe_us: "Amount due from you", we_owe: "Amount due to you", zero: "No balance",
    ask: "Please compare it with your records and let us know whether you agree.",
    confirm: "We agree", dispute: "We do not agree", name: "Your full name", note: "Comment (reason for any difference)", their: "Balance in your records",
    send: "Send", thanks_ok: "Thank you, your confirmation has been recorded.", thanks_dispute: "Thank you, your response has been sent; we will contact you.",
    already: (s, d) => `This confirmation was ${s === "confirmed" ? "accepted" : "disputed"} on ${d}.`,
    footer: "If no reply is received within 15 days, the balance will be deemed confirmed.",
    wa: (p, d, l) => `Dear ${p}, you can review and confirm your account balance as of ${d} here: ${l}`,
  },
  fr: {
    title: "Confirmation de solde",
    intro: (c, d) => `Selon les écritures de ${c}, le solde de votre compte au ${d} est le suivant.`,
    owe_us: "Montant dû par vous", we_owe: "Montant dû à vous", zero: "Aucun solde",
    ask: "Merci de le comparer à vos écritures et de nous indiquer si vous êtes d’accord.",
    confirm: "Nous sommes d’accord", dispute: "Nous ne sommes pas d’accord", name: "Nom et prénom", note: "Commentaire (raison de l’écart)", their: "Solde dans vos écritures",
    send: "Envoyer", thanks_ok: "Merci, votre confirmation a été enregistrée.", thanks_dispute: "Merci, votre réponse a été transmise ; nous vous contacterons.",
    already: (s, d) => `Cette confirmation a été ${s === "confirmed" ? "acceptée" : "contestée"} le ${d}.`,
    footer: "Sans réponse sous 15 jours, le solde sera réputé confirmé.",
    wa: (p, d, l) => `Bonjour ${p}, vous pouvez consulter et confirmer votre solde au ${d} ici : ${l}`,
  },
};
export const reconLang = (l: string | null | undefined): ReconLang => (l === "en" || l === "fr" ? l : "tr");
export const reconDate = (iso: string, l: ReconLang) => new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString(l === "tr" ? "tr-TR" : l === "fr" ? "fr-FR" : "en-GB", { day: "2-digit", month: "long", year: "numeric" });
export const reconMoney = (minor: number, cur: string, l: ReconLang) => (Math.abs(minor) / 100).toLocaleString(l === "tr" ? "tr-TR" : l === "fr" ? "fr-FR" : "en-GB", { style: "currency", currency: cur });
