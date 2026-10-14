import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { accessToken, gmailConfigured, sendMail } from "@/lib/gmail";
import { waConfigured, waSendTemplate } from "@/lib/whatsapp";
import { waNumber } from "@/lib/wa";

type Q = { event_id: number; case_id: string; case_no: number; patient_ref: string; status: string; account_name: string; email: string | null; whatsapp: string | null; language: string; notify_email: boolean; notify_whatsapp: boolean };
const ST: Record<string, Record<string, string>> = {
  tr: { design: "tasarıma alındı", production: "üretime alındı", quality: "kalite kontrolde", shipped: "kargoya verildi", delivered: "teslim edildi", on_hold: "beklemeye alındı (bilgi gerekiyor)" },
  en: { design: "is in design", production: "is in production", quality: "is in quality control", shipped: "has been shipped", delivered: "has been delivered", on_hold: "is on hold (information needed)" },
  fr: { design: "est en conception", production: "est en production", quality: "est en contrôle qualité", shipped: "a été expédié", delivered: "a été livré", on_hold: "est en attente (information nécessaire)" },
};
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Portal vakası durum değişince hekime e-posta / WhatsApp (zamanlanmış görev) */
export async function sendPortalStatusNotices(): Promise<{ email: number; whatsapp: number; skipped: number }> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("portal_notify_queue", { p_limit: 40 });
  if (error || !data?.length) return { email: 0, whatsapp: 0, skipped: 0 };
  const rows = data as Q[];
  const site = (process.env.NEXT_PUBLIC_SITE_URL || "https://mbdentaire.com").replace(/\/+$/, "");
  let mailer: { token: string; email: string; name: string } | null = null;
  if (gmailConfigured()) {
    try {
      const { data: set } = await admin.from("pur_settings").select("mail_account_id").limit(1).maybeSingle();
      const accId = (set?.mail_account_id as string | undefined) ?? ((await admin.from("mail_accounts").select("id").limit(1).maybeSingle()).data?.id as string | undefined);
      if (accId) {
        const { data: acc } = await admin.from("mail_accounts").select("id, user_id, display_name").eq("id", accId).maybeSingle();
        if (acc) { const tk = await accessToken(acc.id as string, acc.user_id as string); mailer = { ...tk, name: (acc.display_name as string) || "MB Dental" }; }
      }
    } catch { mailer = null; }
  }
  let email = 0, whatsapp = 0, skipped = 0;
  for (const r of rows) {
    const lang = ["tr", "en", "fr"].includes(r.language) ? r.language : "tr";
    const st = ST[lang]![r.status] ?? r.status;
    const link = `${site}/portal/vaka/${r.case_id}`;
    const text = lang === "tr" ? `MB Dental: #${r.case_no} (${r.patient_ref}) vakanız ${st}. Ayrıntı: ${link}`
      : lang === "fr" ? `MB Dental : votre cas #${r.case_no} (${r.patient_ref}) ${st}. Détails : ${link}` : `MB Dental: your case #${r.case_no} (${r.patient_ref}) ${st}. Details: ${link}`;
    let sent = false;
    if (r.notify_email && r.email && mailer) {
      try {
        await sendMail(mailer.token, { from: mailer.email, fromName: mailer.name, to: r.email, subject: `#${r.case_no} · ${r.patient_ref} · ${st}`,
          html: `<div style="font-family:Arial,sans-serif;color:#1d2733;max-width:560px"><p>${esc(text.replace(link, ""))}</p><p style="margin:20px 0"><a href="${link}" style="background:#072A50;color:#fff;padding:11px 18px;border-radius:8px;text-decoration:none;font-weight:bold">${lang === "tr" ? "Vakayı aç" : lang === "fr" ? "Ouvrir le cas" : "Open case"}</a></p><p style="font-size:12px;color:#5b6b7c">${lang === "tr" ? "Bildirim tercihlerinizi portal › Profil sayfasından değiştirebilirsiniz." : lang === "fr" ? "Modifiez vos préférences dans portail › Profil." : "Change notification preferences in portal › Profile."}</p></div>`, text });
        email++; sent = true;
      } catch { /* sonraki kanal */ }
    }
    const num = waNumber(r.whatsapp);
    if (r.notify_whatsapp && num && waConfigured() && ["shipped", "delivered", "on_hold"].includes(r.status)) {
      try { await waSendTemplate(num, text); whatsapp++; sent = true; } catch { /* yok */ }
    }
    if (!sent) skipped++;
  }
  await admin.rpc("portal_notify_mark", { p_ids: rows.map((r) => r.event_id) });
  return { email, whatsapp, skipped };
}
