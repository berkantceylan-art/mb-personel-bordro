"use server";
import { createClient } from "@/lib/supabase/server";
import { ERP_URL } from "@/lib/handoff";

export type VisitState = { ok: boolean; error?: string; link?: string; no?: string; at?: number };

const ERR: Record<string, Record<string, string>> = {
  tr: { host: "Kimi ziyaret edeceğinizi seçin.", name: "Adınızı ve soyadınızı yazın.", phone: "Telefon numaranızı yazın.", kvkk: "Aydınlatma metnini onaylayın.", time: "Geçerli bir gün ve saat seçin (en az 30 dakika sonrası, en fazla 60 gün içinde).", hours: "Seçtiğiniz gün / saat ziyaret saatleri dışında.", many: "Çok fazla talep gönderildi; lütfen daha sonra tekrar deneyin.", other: "Talep gönderilemedi, lütfen tekrar deneyin." },
  en: { host: "Choose who you are visiting.", name: "Enter your full name.", phone: "Enter your phone number.", kvkk: "Please accept the privacy notice.", time: "Choose a valid day and time (at least 30 minutes ahead, within 60 days).", hours: "The chosen day / time is outside visiting hours.", many: "Too many requests; please try again later.", other: "The request could not be sent, please try again." },
  fr: { host: "Choisissez la personne à rencontrer.", name: "Indiquez vos nom et prénom.", phone: "Indiquez votre numéro de téléphone.", kvkk: "Veuillez accepter la notice de confidentialité.", time: "Choisissez un jour et une heure valides (au moins 30 minutes à l’avance, sous 60 jours).", hours: "Le jour / l’heure choisis sont hors des horaires de visite.", many: "Trop de demandes ; réessayez plus tard.", other: "La demande n’a pas pu être envoyée, réessayez." },
};

/** Siteden ziyaret randevusu talebi (giriş gerektirmez) */
export async function requestVisit(_: VisitState, f: FormData): Promise<VisitState> {
  const lang = ["tr", "en", "fr"].includes(String(f.get("locale"))) ? String(f.get("locale")) : "tr";
  const e = ERR[lang]!;
  if (String(f.get("website") ?? "")) return { ok: true, at: Date.now() };
  const day = String(f.get("day") ?? "");
  const time = String(f.get("time") ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !/^\d{2}:\d{2}$/.test(time)) return { ok: false, error: e.time };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("vis_request", { p: {
    host_id: String(f.get("host") ?? ""), at: `${day}T${time}:00+03:00`,
    visitor_name: String(f.get("name") ?? "").slice(0, 120), visitor_company: String(f.get("company") ?? "").slice(0, 120),
    phone: String(f.get("phone") ?? "").slice(0, 40), email: String(f.get("email") ?? "").slice(0, 200),
    purpose: String(f.get("purpose") ?? "").slice(0, 200), count: String(f.get("count") ?? "1"), kvkk: f.get("kvkk") === "on",
  } });
  if (error) {
    const m = error.message;
    return { ok: false, error: /host_required/.test(m) ? e.host : /name_required/.test(m) ? e.name : /phone_required/.test(m) ? e.phone : /kvkk_required/.test(m) ? e.kvkk : /bad_time/.test(m) ? e.time : /outside_hours/.test(m) ? e.hours : /too_many/.test(m) ? e.many : e.other };
  }
  const r = data as { token: string; no: string };
  const vt = String(f.get("visitor_type") ?? "");
  if (vt) await supabase.rpc("vis_set_type", { p_token: r.token, p_type: vt });
  return { ok: true, no: r.no, link: `${ERP_URL || ""}/z/${r.token}`, at: Date.now() };
}
