import type { Locale } from "./i18n";

export const STAGE_UI: Record<Locale, Record<string, string>> = {
  tr: { reception: "Kabul edildi", production: "Üretimde", chief: "Şef kontrolünde", qc: "Kalite kontrolde", dispatch: "Sevke hazırlanıyor", tryin: "Provada", out: "Gönderildi", now: "Şu an" },
  en: { reception: "Received", production: "In production", chief: "Chief technician check", qc: "Quality control", dispatch: "Preparing dispatch", tryin: "At try-in", out: "Dispatched", now: "Now" },
  fr: { reception: "Réceptionné", production: "En production", chief: "Contrôle du chef", qc: "Contrôle qualité", dispatch: "Préparation de l'envoi", tryin: "En essayage", out: "Expédié", now: "Actuellement" },
};
export const PLUS_UI: Record<Locale, {
  rateTitle: string; rateLead: string; fit: string; shade: string; service: string; comment: string; send: string; thanks: string; yourRating: string;
  tplTitle: string; tplSave: string; tplName: string; tplSaved: string; tplUse: string; tplNone: string; lots: string; lotItem: string; lot: string; expiry: string;
  notifyTitle: string; notifyEmail: string; notifyWa: string; save: string;
}> = {
  tr: { rateTitle: "Vakayı değerlendirin", rateLead: "30 saniye: geri bildiriminiz doğrudan kalite ekibimize gider.", fit: "Uyum / oturma", shade: "Renk", service: "Hizmet / süre", comment: "Yorum (isteğe bağlı)", send: "Gönder", thanks: "Teşekkürler, değerlendirmeniz alındı.", yourRating: "Değerlendirmeniz",
    tplTitle: "Reçete şablonları", tplSave: "Bu reçeteyi şablon olarak kaydet", tplName: "Şablon adı (ör. Zirkon arka grup A2)", tplSaved: "Şablon kaydedildi.", tplUse: "Şablondan başla", tplNone: "Henüz şablon yok. Bir vakanın sayfasından reçeteyi şablon kaydedebilirsiniz.",
    lots: "Kullanılan malzemeler ve lot numaraları", lotItem: "Malzeme", lot: "Lot", expiry: "Son kullanma", notifyTitle: "Bildirim tercihleri", notifyEmail: "Vaka durumu değişince e-posta gönder", notifyWa: "Vaka durumu değişince WhatsApp mesajı gönder", save: "Kaydet" },
  en: { rateTitle: "Rate this case", rateLead: "30 seconds: your feedback goes straight to our quality team.", fit: "Fit", shade: "Shade", service: "Service / timing", comment: "Comment (optional)", send: "Send", thanks: "Thank you, your rating was received.", yourRating: "Your rating",
    tplTitle: "Prescription templates", tplSave: "Save this prescription as a template", tplName: "Template name (e.g. Posterior zirconia A2)", tplSaved: "Template saved.", tplUse: "Start from a template", tplNone: "No templates yet. Save a prescription as a template from a case page.",
    lots: "Materials and lot numbers used", lotItem: "Material", lot: "Lot", expiry: "Expiry", notifyTitle: "Notification preferences", notifyEmail: "E-mail me when a case status changes", notifyWa: "Send WhatsApp when a case status changes", save: "Save" },
  fr: { rateTitle: "Évaluez ce cas", rateLead: "30 secondes : votre avis va directement à notre équipe qualité.", fit: "Adaptation", shade: "Teinte", service: "Service / délai", comment: "Commentaire (facultatif)", send: "Envoyer", thanks: "Merci, votre évaluation a été reçue.", yourRating: "Votre évaluation",
    tplTitle: "Modèles de prescription", tplSave: "Enregistrer cette prescription comme modèle", tplName: "Nom du modèle (ex. Zircone postérieure A2)", tplSaved: "Modèle enregistré.", tplUse: "Partir d'un modèle", tplNone: "Aucun modèle. Enregistrez une prescription comme modèle depuis la page d'un cas.",
    lots: "Matériaux et numéros de lot utilisés", lotItem: "Matériau", lot: "Lot", expiry: "Péremption", notifyTitle: "Préférences de notification", notifyEmail: "M'envoyer un e-mail quand le statut change", notifyWa: "M'envoyer un WhatsApp quand le statut change", save: "Enregistrer" },
};
