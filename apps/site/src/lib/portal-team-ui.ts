// Portal ekip (klinik), müşteriler (aracı kuruluş), davet kodu, logo — TR/EN/FR
import type { Locale } from "./i18n";

type T = {
  teamNav: string;
  teamTitle: string;
  teamLead: string;
  members: string;
  admin: string;
  member: string;
  you: string;
  remove: string;
  invite: string;
  inviteLead: string;
  inviteName: string;
  inviteRole: string;
  create: string;
  codes: string;
  code: string;
  expires: string;
  used: string;
  howTo: string;
  logo: string;
  logoLead: string;
  upload: string;
  removeLogo: string;
  onlyAdmin: string;
  clientsNav: string;
  clientsTitle: string;
  clientsLead: string;
  clientName: string;
  country: string;
  city: string;
  phone: string;
  note: string;
  add: string;
  cases: string;
  noClients: string;
  client: string;
  clientNone: string;
  sender: string;
  all: string;
  mine: string;
  joinTitle: string;
  joinLead: string;
  join: string;
  inviteCode: string;
  inviteCodeHint: string;
  errors: Record<string, string>;
  distributor: string;
};

export const TEAM_UI: Record<Locale, T> = {
  tr: {
    teamNav: "Ekip",
    teamTitle: "Ekip ve hesap",
    teamLead: "Kliniğinizdeki hekim ve asistanları aynı hesaba ekleyin; herkes kendi şifresiyle girer, vakaları birlikte görürsünüz.",
    members: "Hesaptaki kişiler",
    admin: "Yönetici",
    member: "Üye",
    you: "siz",
    remove: "Çıkar",
    invite: "Kişi ekle",
    inviteLead: "Katılma kodu oluşturun ve kişiye iletin. Kişi portal kayıt sayfasında bu kodu girerek hesabınıza katılır (kod 14 gün geçerlidir).",
    inviteName: "Ad (ör. Dr. Elif Kaya)",
    inviteRole: "Yetki",
    create: "Kod oluştur",
    codes: "Bekleyen kodlar",
    code: "Kod",
    expires: "Son gün",
    used: "kullanıldı",
    howTo: "Kayıt sayfası",
    logo: "Logo",
    logoLead: "Logonuz belgelerde (uygunluk beyanı, proforma) görünür.",
    upload: "Logo yükle",
    removeLogo: "Logoyu kaldır",
    onlyAdmin: "Bu bölümü yalnız hesap yöneticisi düzenleyebilir.",
    clientsNav: "Müşterilerim",
    clientsTitle: "Müşterilerim",
    clientsLead: "Vaka gönderdiğiniz hekim ve klinikler. Yeni vaka açarken seçersiniz; vakaları müşteri bazında izlersiniz.",
    clientName: "Hekim / klinik adı",
    country: "Ülke",
    city: "Şehir",
    phone: "Telefon",
    note: "Not",
    add: "Ekle",
    cases: "Vaka",
    noClients: "Henüz müşteri yok.",
    client: "Müşteri (hekim / klinik)",
    clientNone: "— seçmeyin —",
    sender: "Gönderen",
    all: "Tümü",
    mine: "Benim vakalarım",
    joinTitle: "Davet kodunuz var mı?",
    joinLead: "Kliniğinizin ya da kurumunuzun verdiği kodla mevcut hesaba katılın.",
    join: "Hesaba katıl",
    inviteCode: "Davet kodu (varsa)",
    inviteCodeHint: "Kliniğiniz kod verdiyse yazın; yeni hesap açılmaz, mevcut hesaba katılırsınız.",
    errors: { invalid_code: "Kod geçersiz, kullanılmış ya da süresi dolmuş.", already_member: "Bu kullanıcı zaten bir hesaba bağlı.", not_allowed: "Bu işlem için yetkiniz yok.", rate_limited: "Bugün çok fazla kod oluşturuldu.", self: "Kendinizi çıkaramazsınız.", server: "İşlem yapılamadı, tekrar deneyin." },
    distributor: "Aracı kuruluş",
  },
  en: {
    teamNav: "Team",
    teamTitle: "Team & account",
    teamLead: "Add the dentists and assistants of your clinic to the same account; everyone signs in with their own password and sees the cases together.",
    members: "People on this account",
    admin: "Admin",
    member: "Member",
    you: "you",
    remove: "Remove",
    invite: "Add a person",
    inviteLead: "Create a join code and send it to the person. They enter the code on the portal sign-up page to join your account (valid for 14 days).",
    inviteName: "Name (e.g. Dr Emma Martin)",
    inviteRole: "Role",
    create: "Create code",
    codes: "Pending codes",
    code: "Code",
    expires: "Expires",
    used: "used",
    howTo: "Sign-up page",
    logo: "Logo",
    logoLead: "Your logo appears on documents (declaration, pro forma).",
    upload: "Upload logo",
    removeLogo: "Remove logo",
    onlyAdmin: "Only the account admin can edit this section.",
    clientsNav: "My clients",
    clientsTitle: "My clients",
    clientsLead: "Dentists and clinics you send cases for. Pick one when you create a case and follow cases per client.",
    clientName: "Dentist / clinic name",
    country: "Country",
    city: "City",
    phone: "Phone",
    note: "Note",
    add: "Add",
    cases: "Cases",
    noClients: "No clients yet.",
    client: "Client (dentist / clinic)",
    clientNone: "— none —",
    sender: "Sent by",
    all: "All",
    mine: "My cases",
    joinTitle: "Do you have an invitation code?",
    joinLead: "Join your clinic’s or organisation’s existing account with the code they gave you.",
    join: "Join account",
    inviteCode: "Invitation code (optional)",
    inviteCodeHint: "If your clinic gave you a code, enter it: you will join their account instead of opening a new one.",
    errors: { invalid_code: "The code is invalid, used or expired.", already_member: "This user already belongs to an account.", not_allowed: "You are not allowed to do this.", rate_limited: "Too many codes created today.", self: "You cannot remove yourself.", server: "Something went wrong, please try again." },
    distributor: "Intermediary",
  },
  fr: {
    teamNav: "Équipe",
    teamTitle: "Équipe et compte",
    teamLead: "Ajoutez les praticiens et assistants de votre cabinet au même compte ; chacun se connecte avec son propre mot de passe et vous suivez les cas ensemble.",
    members: "Personnes du compte",
    admin: "Administrateur",
    member: "Membre",
    you: "vous",
    remove: "Retirer",
    invite: "Ajouter une personne",
    inviteLead: "Créez un code d’accès et transmettez-le. La personne saisit ce code sur la page d’inscription du portail pour rejoindre votre compte (valable 14 jours).",
    inviteName: "Nom (ex. Dr Emma Martin)",
    inviteRole: "Rôle",
    create: "Créer le code",
    codes: "Codes en attente",
    code: "Code",
    expires: "Expire le",
    used: "utilisé",
    howTo: "Page d’inscription",
    logo: "Logo",
    logoLead: "Votre logo figure sur les documents (déclaration, proforma).",
    upload: "Téléverser le logo",
    removeLogo: "Supprimer le logo",
    onlyAdmin: "Seul l’administrateur du compte peut modifier cette section.",
    clientsNav: "Mes clients",
    clientsTitle: "Mes clients",
    clientsLead: "Les praticiens et cabinets pour lesquels vous envoyez des cas. Choisissez-les à la création d’un cas et suivez les cas par client.",
    clientName: "Nom du praticien / cabinet",
    country: "Pays",
    city: "Ville",
    phone: "Téléphone",
    note: "Remarque",
    add: "Ajouter",
    cases: "Cas",
    noClients: "Aucun client pour le moment.",
    client: "Client (praticien / cabinet)",
    clientNone: "— aucun —",
    sender: "Envoyé par",
    all: "Tous",
    mine: "Mes cas",
    joinTitle: "Vous avez un code d’invitation ?",
    joinLead: "Rejoignez le compte existant de votre cabinet ou organisme avec le code reçu.",
    join: "Rejoindre le compte",
    inviteCode: "Code d’invitation (facultatif)",
    inviteCodeHint: "Si votre cabinet vous a donné un code, saisissez-le : vous rejoindrez son compte au lieu d’en créer un nouveau.",
    errors: { invalid_code: "Code invalide, déjà utilisé ou expiré.", already_member: "Cet utilisateur appartient déjà à un compte.", not_allowed: "Action non autorisée.", rate_limited: "Trop de codes créés aujourd’hui.", self: "Vous ne pouvez pas vous retirer vous-même.", server: "Une erreur est survenue, réessayez." },
    distributor: "Intermédiaire",
  },
};
