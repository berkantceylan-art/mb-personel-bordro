/** İşe alım (ATS) sabitleri: aşamalar, kaynaklar, mülakat ölçütleri */
export const STAGES = [
  ["new", "Yeni"],
  ["screen", "Ön eleme"],
  ["interview", "Mülakat"],
  ["trial", "Deneme günü"],
  ["offer", "Teklif"],
  ["hired", "İşe alındı"],
] as const;
export type Stage = (typeof STAGES)[number][0] | "rejected" | "withdrawn";
export const STAGE_LABEL: Record<string, string> = { ...Object.fromEntries(STAGES), rejected: "Reddedildi", withdrawn: "Aday çekildi" };
export const nextStage = (s: string) => { const i = STAGES.findIndex(([k]) => k === s); return i >= 0 && i < STAGES.length - 1 ? STAGES[i + 1]![0] : null; };

export const SOURCE_LABEL: Record<string, string> = { web: "Web sitesi", mobile: "Mobil", manual: "Elle eklendi", referral: "Çalışan tavsiyesi", iskur: "İŞKUR", other: "Diğer" };

export const CRITERIA = [
  ["beceri", "Mesleki beceri"],
  ["deneyim", "Deneyim"],
  ["iletisim", "İletişim"],
  ["uyum", "Takım uyumu"],
  ["ozen", "Özen ve titizlik"],
] as const;

export const SKILL_OPTIONS = ["Porselen", "Zirkon", "İskelet / metal", "CAD/CAM (Exocad, 3Shape)", "Alçı / model", "3D baskı", "Hareketli protez", "Ehliyet (B)", "Ehliyet (A2, motosiklet)"];
export const EXPERIENCE_OPTIONS = ["Deneyimsiz / stajyer", "1 yıldan az", "1–3 yıl", "3–5 yıl", "5 yıldan fazla"];
export const EDUCATION_OPTIONS = ["Diş protez teknikerliği (ön lisans)", "Diş protez meslek lisesi", "Lise", "Lisans", "Diğer"];
export const HEARD_OPTIONS = ["Web sitesi", "Çalışanımızın tavsiyesi", "İŞKUR", "İlan sitesi", "Sosyal medya", "Diğer"];

/** Türkiye cep numarası: 05xxxxxxxxx biçimine getirir; geçersizse null */
export function normalizePhone(v: string): string | null {
  let d = v.replace(/\D/g, "");
  if (d.startsWith("90")) d = d.slice(2);
  if (d.length === 10 && d.startsWith("5")) d = "0" + d;
  return /^05\d{9}$/.test(d) ? d : null;
}
export const formatPhone = (p: string) => (/^05\d{9}$/.test(p) ? `${p.slice(0, 4)} ${p.slice(4, 7)} ${p.slice(7, 9)} ${p.slice(9)}` : p);
/** WhatsApp sohbet bağlantısı (hazır mesajla) */
export const whatsappLink = (phone: string, text: string) => {
  const d = phone.replace(/\D/g, "");
  const intl = d.startsWith("90") ? d : d.startsWith("0") ? `9${d}` : `90${d}`;
  return `https://wa.me/${intl}?text=${encodeURIComponent(text)}`;
};

export const slugify = (s: string) =>
  s.toLocaleLowerCase("tr").replace(/ı/g, "i").replace(/ğ/g, "g").replace(/ü/g, "u").replace(/ş/g, "s").replace(/ö/g, "o").replace(/ç/g, "c").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "ilan";

/** Sitenin dışarıdan erişilen adresi (SMS / WhatsApp bağlantıları için) */
export const publicBaseUrl = () => process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "");
