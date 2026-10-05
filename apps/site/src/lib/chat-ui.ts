// Canlı destek: istemci ve sunucuda kullanılabilen tipler ve metinler
import type { Locale } from "./i18n";

export type ChatMessage = { id: number; sender: "visitor" | "staff"; body: string; at: string };
export type ChatSnapshot = {
  chat: { status: "open" | "closed"; name: string; messages: ChatMessage[] } | null;
  error?: "required" | "email" | "rate" | "spam" | "server" | "gone";
};

type HubText = {
  button: string;
  title: string;
  lead: string;
  close: string;
  tabs: { chat: string; whatsapp: string; contact: string };
  name: string;
  email: string;
  emailHint: string;
  message: string;
  start: string;
  offline: string;
  online: string;
  you: string;
  lab: string;
  placeholder: string;
  send: string;
  newChat: string;
  closedNote: string;
  waLead: string;
  waTopics: { label: string; text: string }[];
  call: string;
  write: string;
  links: { case: string; portal: string; faq: string; form: string };
  errors: Record<NonNullable<ChatSnapshot["error"]>, string>;
  chatOff: string;
  back: string;
  top: string;
};

export const HUB_UI: Record<Locale, HubText> = {
  tr: {
    button: "Destek",
    title: "Size nasıl yardımcı olabiliriz?",
    lead: "Laboratuvar ekibimiz burada.",
    close: "Kapat",
    tabs: { chat: "Canlı destek", whatsapp: "WhatsApp", contact: "Ara / yaz" },
    name: "Adınız",
    email: "E-posta (isteğe bağlı)",
    emailHint: "Çevrim dışıysak cevabı buraya da yazarız.",
    message: "Mesajınız",
    start: "Konuşmayı başlat",
    offline: "Şu an mesai dışındayız. Mesajınızı bırakın, ilk iş saatinde dönelim.",
    online: "Ekibimiz çevrim içi; genelde birkaç dakikada cevap veriyoruz.",
    you: "Siz",
    lab: "MB Dental",
    placeholder: "Mesajınızı yazın…",
    send: "Gönder",
    newChat: "Yeni konuşma",
    closedNote: "Bu konuşma kapatıldı. Yazarsanız yeniden açılır.",
    waLead: "Konuyu seçin, WhatsApp hazır mesajla açılsın:",
    waTopics: [
      { label: "Vaka durumu", text: "Merhaba, vakamın durumunu öğrenmek istiyorum. Hasta kodu / vaka no: " },
      { label: "Fiyat listesi", text: "Merhaba, güncel fiyat listenizi alabilir miyim?" },
      { label: "Kurye / ölçü alım", text: "Merhaba, kurye ile ölçü alımı talep ediyorum. Klinik adı ve adres: " },
      { label: "Dijital dosya / teknik destek", text: "Merhaba, tarama dosyası gönderimiyle ilgili destek istiyorum." },
      { label: "Diğer", text: "Merhaba, " },
    ],
    call: "Bizi arayın",
    write: "E-posta gönderin",
    links: { case: "Vaka gönder", portal: "Hekim portalı", faq: "Sıkça sorulanlar", form: "İletişim formu" },
    errors: {
      required: "Adınızı ve mesajınızı yazın.",
      email: "E-posta adresini kontrol edin.",
      rate: "Çok sık mesaj gönderildi, biraz sonra tekrar deneyin.",
      spam: "Biraz bekleyip tekrar deneyin.",
      server: "Şu an bağlanamadık. Lütfen WhatsApp ya da telefonla ulaşın.",
      gone: "Konuşma bulunamadı; yeni bir konuşma başlatabilirsiniz.",
    },
    chatOff: "Canlı destek şu an kapalı. WhatsApp ya da telefonla ulaşabilirsiniz.",
    back: "Geri",
    top: "Sayfanın başına dön",
  },
  en: {
    button: "Support",
    title: "How can we help?",
    lead: "Our lab team is here for you.",
    close: "Close",
    tabs: { chat: "Live chat", whatsapp: "WhatsApp", contact: "Call / write" },
    name: "Your name",
    email: "Email (optional)",
    emailHint: "If we're offline we'll reply here too.",
    message: "Your message",
    start: "Start chat",
    offline: "We're outside office hours. Leave a message and we'll get back to you first thing.",
    online: "Our team is online and usually replies within minutes.",
    you: "You",
    lab: "MB Dental",
    placeholder: "Type your message…",
    send: "Send",
    newChat: "New chat",
    closedNote: "This chat was closed. Writing again reopens it.",
    waLead: "Pick a topic to open WhatsApp with a ready message:",
    waTopics: [
      { label: "Case status", text: "Hello, I'd like to check the status of my case. Patient code / case no: " },
      { label: "Price list", text: "Hello, could I receive your current price list?" },
      { label: "Shipping / pickup", text: "Hello, I'd like to arrange shipping of a case. Clinic and address: " },
      { label: "Digital files / technical", text: "Hello, I need help sending scan files." },
      { label: "Other", text: "Hello, " },
    ],
    call: "Call us",
    write: "Send an email",
    links: { case: "Send a case", portal: "Doctor portal", faq: "FAQ", form: "Contact form" },
    errors: {
      required: "Please enter your name and message.",
      email: "Please check the email address.",
      rate: "Too many messages, please try again shortly.",
      spam: "Please wait a moment and try again.",
      server: "We couldn't connect right now. Please reach us on WhatsApp or by phone.",
      gone: "Chat not found; you can start a new one.",
    },
    chatOff: "Live chat is currently off. Reach us on WhatsApp or by phone.",
    back: "Back",
    top: "Back to top",
  },
  fr: {
    button: "Aide",
    title: "Comment pouvons-nous aider ?",
    lead: "Notre équipe du laboratoire est là.",
    close: "Fermer",
    tabs: { chat: "Chat en direct", whatsapp: "WhatsApp", contact: "Appeler / écrire" },
    name: "Votre nom",
    email: "E-mail (facultatif)",
    emailHint: "Si nous sommes hors ligne, nous répondrons aussi ici.",
    message: "Votre message",
    start: "Démarrer le chat",
    offline: "Nous sommes hors des heures d’ouverture. Laissez un message, nous vous répondrons dès que possible.",
    online: "Notre équipe est en ligne et répond généralement en quelques minutes.",
    you: "Vous",
    lab: "MB Dental",
    placeholder: "Écrivez votre message…",
    send: "Envoyer",
    newChat: "Nouveau chat",
    closedNote: "Ce chat a été clôturé. Écrire à nouveau le rouvre.",
    waLead: "Choisissez un sujet pour ouvrir WhatsApp avec un message prêt :",
    waTopics: [
      { label: "Suivi de cas", text: "Bonjour, je souhaite connaître l’état de mon cas. Code patient / n° de cas : " },
      { label: "Liste de prix", text: "Bonjour, pourrais-je recevoir votre liste de prix actuelle ?" },
      { label: "Envoi / enlèvement", text: "Bonjour, je souhaite organiser l’envoi d’un cas. Cabinet et adresse : " },
      { label: "Fichiers numériques / technique", text: "Bonjour, j’ai besoin d’aide pour envoyer des fichiers de scan." },
      { label: "Autre", text: "Bonjour, " },
    ],
    call: "Appelez-nous",
    write: "Envoyer un e-mail",
    links: { case: "Envoyer un cas", portal: "Portail praticien", faq: "FAQ", form: "Formulaire de contact" },
    errors: {
      required: "Indiquez votre nom et votre message.",
      email: "Vérifiez l’adresse e-mail.",
      rate: "Trop de messages, réessayez dans un instant.",
      spam: "Patientez un instant puis réessayez.",
      server: "Connexion impossible pour le moment. Contactez-nous par WhatsApp ou par téléphone.",
      gone: "Chat introuvable ; vous pouvez en démarrer un nouveau.",
    },
    chatOff: "Le chat en direct est désactivé. Contactez-nous par WhatsApp ou par téléphone.",
    back: "Retour",
    top: "Retour en haut",
  },
};
