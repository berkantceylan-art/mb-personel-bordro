import type { Locale } from "./i18n";

export type PortalAccountType = "doctor_tr" | "doctor_foreign" | "clinic" | "agency";
export type PortalStatus = "pending" | "active" | "suspended";
export type CaseStatus = "received" | "design" | "production" | "quality" | "shipped" | "delivered" | "on_hold" | "cancelled";
export const CASE_FLOW: CaseStatus[] = ["received", "design", "production", "quality", "shipped", "delivered"];
export const CASE_STATUSES: CaseStatus[] = [...CASE_FLOW, "on_hold", "cancelled"];

export type PortalAccount = {
  id: string;
  type: PortalAccountType;
  status: PortalStatus;
  name: string;
  company: string | null;
  country: string;
  city: string | null;
  phone: string | null;
  email: string | null;
  language: Locale;
  note: string | null;
  approved_at: string | null;
  created_at: string;
};

export type PortalCase = {
  id: string;
  no: number;
  account_id: string;
  patient_ref: string;
  product_slug: string | null;
  teeth: number[] | null;
  shade: string | null;
  due_date: string | null;
  notes: string | null;
  status: CaseStatus;
  tracking: string | null;
  created_at: string;
  updated_at: string;
};

export type CaseFile = { id: string; case_id: string; path: string; name: string; size: number | null; mime: string | null; from_lab: boolean; created_at: string };
export type CaseEvent = { id: number; case_id: string; kind: "status" | "message" | "file"; status: CaseStatus | null; body: string | null; from_lab: boolean; created_at: string };

export const PORTAL_BUCKET = "portal-files";

export const STATUS_CLS: Record<CaseStatus, string> = {
  received: "bg-porcelain text-navy",
  design: "bg-[#e7f1fb] text-blue",
  production: "bg-[#e7f1fb] text-blue",
  quality: "bg-warn-bg text-warn",
  shipped: "bg-[#def5fc] text-smile-ink",
  delivered: "bg-ok-bg text-ok",
  on_hold: "bg-warn-bg text-warn",
  cancelled: "bg-gypsum text-slate",
};

/** Hasta kodu: ad soyad değil, kısa kod (KVKK/GDPR) */
export const PATIENT_REF_RE = /^[\p{L}\p{N} ._\-/#]{1,40}$/u;

export const PORTAL_UI: Record<
  Locale,
  {
    title: string;
    types: Record<PortalAccountType, string>;
    statuses: Record<CaseStatus, string>;
    nav: { cases: string; newCase: string; account: string; signOut: string; site: string };
    pending: { title: string; text: string };
    suspended: { title: string; text: string };
    list: { empty: string; no: string; patient: string; product: string; teeth: string; status: string; date: string; due: string; total: string; open: string };
    form: {
      title: string;
      patient: string;
      patientHint: string;
      product: string;
      productNone: string;
      teeth: string;
      teethHint: string;
      upper: string;
      lower: string;
      shade: string;
      due: string;
      notes: string;
      files: string;
      filesHint: string;
      submit: string;
      sending: string;
      uploading: string;
      errors: Record<"patient" | "teeth" | "server" | "inactive" | "file", string>;
    };
    detail: { info: string; timeline: string; files: string; noFiles: string; message: string; messagePh: string; send: string; addFiles: string; lab: string; you: string; tracking: string; download: string; created: string };
    signup: {
      title: string;
      lead: string;
      type: string;
      name: string;
      company: string;
      country: string;
      city: string;
      phone: string;
      email: string;
      password: string;
      passwordHint: string;
      language: string;
      submit: string;
      haveAccount: string;
      login: string;
      checkEmail: string;
      privacy: string;
      errors: Record<"required" | "password" | "exists" | "server" | "disabled", string>;
    };
  }
> = {
  tr: {
    title: "Hekim portalı",
    types: { doctor_tr: "Hekim (Türkiye)", doctor_foreign: "Hekim (yurtdışı)", clinic: "Klinik", agency: "Aracı kuruluş" },
    statuses: { received: "Alındı", design: "Tasarımda", production: "Üretimde", quality: "Son kontrolde", shipped: "Kargoda", delivered: "Teslim edildi", on_hold: "Beklemede", cancelled: "İptal" },
    nav: { cases: "Vakalarım", newCase: "Yeni vaka", account: "Hesabım", signOut: "Çıkış", site: "Siteye dön" },
    pending: { title: "Başvurunuz inceleniyor", text: "Hesabınız laboratuvarımız tarafından onaylandığında vaka gönderebilirsiniz. Genellikle aynı iş günü içinde onaylanır; acil durumlarda bizi arayın." },
    suspended: { title: "Hesabınız askıya alındı", text: "Ayrıntılı bilgi için laboratuvarımızla iletişime geçin." },
    list: { empty: "Henüz vaka göndermediniz.", no: "No", patient: "Hasta kodu", product: "Ürün", teeth: "Dişler", status: "Durum", date: "Gönderim", due: "İstenen teslim", total: "Toplam", open: "Devam eden" },
    form: {
      title: "Yeni vaka",
      patient: "Hasta kodu",
      patientHint: "Hasta adını yazmayın; baş harfler ya da kendi kayıt numaranız yeterli (ör. AY-104).",
      product: "Ürün",
      productNone: "— Seçin —",
      teeth: "Dişler",
      teethHint: "Şemadan dişlere dokunarak seçin.",
      upper: "Üst çene",
      lower: "Alt çene",
      shade: "Renk",
      due: "İstenen teslim tarihi",
      notes: "Notlar",
      files: "Dosyalar",
      filesHint: "Tarama (STL, PLY, OBJ), fotoğraf, ZIP ya da PDF. Dosya başına en fazla 50 MB.",
      submit: "Vakayı gönder",
      sending: "Gönderiliyor…",
      uploading: "Dosya yükleniyor",
      errors: {
        patient: "Hasta kodunu yazın (en fazla 40 karakter, yalnız harf, rakam ve - . / #).",
        teeth: "En az bir diş seçin ya da notlarda belirtin.",
        server: "Vaka kaydedilemedi. Lütfen tekrar deneyin.",
        inactive: "Hesabınız henüz onaylanmadı.",
        file: "Bir dosya yüklenemedi:",
      },
    },
    detail: {
      info: "Vaka bilgileri",
      timeline: "Vaka geçmişi",
      files: "Dosyalar",
      noFiles: "Dosya yok.",
      message: "Laboratuvara mesaj",
      messagePh: "Sorunuzu ya da ek bilginizi yazın…",
      send: "Gönder",
      addFiles: "Dosya ekle",
      lab: "Laboratuvar",
      you: "Siz",
      tracking: "Kargo takip",
      download: "İndir",
      created: "Vaka açıldı",
    },
    signup: {
      title: "Portal hesabı açın",
      lead: "Vakalarınızı çevrim içi gönderin, dosyalarınızı yükleyin, üretim aşamasını anlık takip edin.",
      type: "Hesap türü",
      name: "Ad soyad",
      company: "Muayenehane / klinik / kuruluş adı",
      country: "Ülke",
      city: "Şehir",
      phone: "Telefon",
      email: "E-posta",
      password: "Şifre",
      passwordHint: "En az 8 karakter.",
      language: "Portal dili",
      submit: "Başvur",
      haveAccount: "Hesabınız var mı?",
      login: "Giriş yapın",
      checkEmail: "Başvurunuz alındı. E-postanıza gelen bağlantıya tıklayarak adresinizi onaylayın, ardından giriş yapın.",
      privacy: "Bilgileriniz yalnız hizmet vermek için kullanılır.",
      errors: {
        required: "Lütfen zorunlu alanları doldurun.",
        password: "Şifre en az 8 karakter olmalı.",
        exists: "Bu e-posta ile zaten bir hesap var. Giriş yapın ya da şifrenizi sıfırlayın.",
        server: "Başvuru şu an alınamadı. Lütfen bizi arayın ya da e-posta gönderin.",
        disabled: "Çevrim içi kayıt şu an kapalı. Başvurunuz için bize e-posta gönderin.",
      },
    },
  },
  en: {
    title: "Dentist portal",
    types: { doctor_tr: "Dentist (Türkiye)", doctor_foreign: "Dentist (international)", clinic: "Clinic", agency: "Agency / intermediary" },
    statuses: { received: "Received", design: "In design", production: "In production", quality: "Final check", shipped: "Shipped", delivered: "Delivered", on_hold: "On hold", cancelled: "Cancelled" },
    nav: { cases: "My cases", newCase: "New case", account: "Account", signOut: "Sign out", site: "Back to site" },
    pending: { title: "Your application is under review", text: "You can send cases once our laboratory approves your account — usually within the same business day. Call us if it is urgent." },
    suspended: { title: "Your account is suspended", text: "Please contact our laboratory for details." },
    list: { empty: "You have not sent any cases yet.", no: "No", patient: "Patient code", product: "Product", teeth: "Teeth", status: "Status", date: "Sent", due: "Requested by", total: "Total", open: "In progress" },
    form: {
      title: "New case",
      patient: "Patient code",
      patientHint: "Do not enter the patient's name; initials or your own record number are enough (e.g. AM-104).",
      product: "Product",
      productNone: "— Select —",
      teeth: "Teeth",
      teethHint: "Tap the teeth on the chart to select them.",
      upper: "Upper jaw",
      lower: "Lower jaw",
      shade: "Shade",
      due: "Requested delivery date",
      notes: "Notes",
      files: "Files",
      filesHint: "Scans (STL, PLY, OBJ), photos, ZIP or PDF. Up to 50 MB per file.",
      submit: "Send case",
      sending: "Sending…",
      uploading: "Uploading",
      errors: {
        patient: "Enter a patient code (max. 40 characters; letters, digits and - . / # only).",
        teeth: "Select at least one tooth or describe it in the notes.",
        server: "The case could not be saved. Please try again.",
        inactive: "Your account has not been approved yet.",
        file: "A file could not be uploaded:",
      },
    },
    detail: {
      info: "Case details",
      timeline: "Case history",
      files: "Files",
      noFiles: "No files.",
      message: "Message to the lab",
      messagePh: "Write your question or additional information…",
      send: "Send",
      addFiles: "Add files",
      lab: "Laboratory",
      you: "You",
      tracking: "Tracking",
      download: "Download",
      created: "Case opened",
    },
    signup: {
      title: "Open a portal account",
      lead: "Send your cases online, upload your files and follow production in real time.",
      type: "Account type",
      name: "Full name",
      company: "Practice / clinic / company name",
      country: "Country",
      city: "City",
      phone: "Phone",
      email: "Email",
      password: "Password",
      passwordHint: "At least 8 characters.",
      language: "Portal language",
      submit: "Apply",
      haveAccount: "Already have an account?",
      login: "Sign in",
      checkEmail: "Application received. Click the link in your email to confirm your address, then sign in.",
      privacy: "Your details are used only to provide our service.",
      errors: {
        required: "Please fill in the required fields.",
        password: "The password must be at least 8 characters.",
        exists: "An account with this email already exists. Sign in or reset your password.",
        server: "We could not take your application right now. Please call or email us.",
        disabled: "Online sign-up is currently closed. Please email us to apply.",
      },
    },
  },
  fr: {
    title: "Espace praticien",
    types: { doctor_tr: "Praticien (Turquie)", doctor_foreign: "Praticien (international)", clinic: "Clinique", agency: "Intermédiaire" },
    statuses: { received: "Reçu", design: "En conception", production: "En production", quality: "Contrôle final", shipped: "Expédié", delivered: "Livré", on_hold: "En attente", cancelled: "Annulé" },
    nav: { cases: "Mes cas", newCase: "Nouveau cas", account: "Mon compte", signOut: "Déconnexion", site: "Retour au site" },
    pending: { title: "Votre demande est en cours d'examen", text: "Vous pourrez envoyer des cas dès que notre laboratoire aura validé votre compte, généralement le jour même. Appelez-nous en cas d'urgence." },
    suspended: { title: "Votre compte est suspendu", text: "Merci de contacter notre laboratoire pour plus d'informations." },
    list: { empty: "Vous n'avez encore envoyé aucun cas.", no: "N°", patient: "Code patient", product: "Produit", teeth: "Dents", status: "Statut", date: "Envoyé", due: "Souhaité pour", total: "Total", open: "En cours" },
    form: {
      title: "Nouveau cas",
      patient: "Code patient",
      patientHint: "N'indiquez pas le nom du patient ; ses initiales ou votre numéro de dossier suffisent (ex. AM-104).",
      product: "Produit",
      productNone: "— Choisir —",
      teeth: "Dents",
      teethHint: "Touchez les dents sur le schéma pour les sélectionner.",
      upper: "Maxillaire",
      lower: "Mandibule",
      shade: "Teinte",
      due: "Date de livraison souhaitée",
      notes: "Remarques",
      files: "Fichiers",
      filesHint: "Scans (STL, PLY, OBJ), photos, ZIP ou PDF. 50 Mo maximum par fichier.",
      submit: "Envoyer le cas",
      sending: "Envoi…",
      uploading: "Envoi du fichier",
      errors: {
        patient: "Indiquez un code patient (40 caractères max. ; lettres, chiffres et - . / # uniquement).",
        teeth: "Sélectionnez au moins une dent ou précisez-le dans les remarques.",
        server: "Le cas n'a pas pu être enregistré. Réessayez.",
        inactive: "Votre compte n'est pas encore validé.",
        file: "Un fichier n'a pas pu être envoyé :",
      },
    },
    detail: {
      info: "Informations du cas",
      timeline: "Historique",
      files: "Fichiers",
      noFiles: "Aucun fichier.",
      message: "Message au laboratoire",
      messagePh: "Écrivez votre question ou une précision…",
      send: "Envoyer",
      addFiles: "Ajouter des fichiers",
      lab: "Laboratoire",
      you: "Vous",
      tracking: "Suivi",
      download: "Télécharger",
      created: "Cas ouvert",
    },
    signup: {
      title: "Créer un compte praticien",
      lead: "Envoyez vos cas en ligne, déposez vos fichiers et suivez la fabrication en temps réel.",
      type: "Type de compte",
      name: "Nom et prénom",
      company: "Cabinet / clinique / société",
      country: "Pays",
      city: "Ville",
      phone: "Téléphone",
      email: "E-mail",
      password: "Mot de passe",
      passwordHint: "8 caractères minimum.",
      language: "Langue de l'espace",
      submit: "Envoyer la demande",
      haveAccount: "Vous avez déjà un compte ?",
      login: "Connexion",
      checkEmail: "Demande reçue. Cliquez sur le lien reçu par e-mail pour confirmer votre adresse, puis connectez-vous.",
      privacy: "Vos données servent uniquement à vous fournir nos services.",
      errors: {
        required: "Merci de remplir les champs obligatoires.",
        password: "Le mot de passe doit comporter au moins 8 caractères.",
        exists: "Un compte existe déjà avec cet e-mail. Connectez-vous ou réinitialisez votre mot de passe.",
        server: "Votre demande n'a pas pu être envoyée. Appelez-nous ou écrivez-nous.",
        disabled: "L'inscription en ligne est fermée pour le moment. Écrivez-nous pour faire une demande.",
      },
    },
  },
};

export function formatDate(iso: string | null, locale: Locale, withTime = false): string {
  if (!iso) return "—";
  const d = iso.length === 10 ? new Date(`${iso}T12:00:00`) : new Date(iso);
  return new Intl.DateTimeFormat(locale === "tr" ? "tr-TR" : locale === "fr" ? "fr-FR" : "en-GB", {
    dateStyle: "medium",
    ...(withTime ? { timeStyle: "short" } : {}),
    timeZone: "Europe/Istanbul",
  }).format(d);
}

export function formatBytes(n: number | null): string {
  if (!n) return "";
  return n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;
}
