import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { accessToken, sendMail, gmailConfigured } from "@/lib/gmail";
import { waConfigured, waSendTemplate } from "@/lib/whatsapp";
import { waNumber } from "@/lib/wa";
import { erpUrl } from "@/lib/po-send";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export type NoticeResult = { via: string[]; errors: string[] };

/**
 * Tedarikçiye e-posta (satın alma ayarlarındaki Gmail hesabından) ve / veya WhatsApp (Cloud API şablonu) gönderir.
 * Alıcılar: carinin sipariş e-postası / e-postası + portal kullanıcıları; telefon: sipariş telefonu / telefon.
 */
export async function sendSupplierNotice(o: {
  partyId: string; subject: string; text: string; email?: boolean; whatsapp?: boolean; path?: string; attachment?: { name: string; mime: string; data: Buffer } | null;
}): Promise<NoticeResult> {
  const admin = createAdminClient();
  const via: string[] = [];
  const errors: string[] = [];
  const { data: p } = await admin.from("fin_parties").select("company_id, name, email, phone, order_email, order_phone, contact_name").eq("id", o.partyId).maybeSingle();
  if (!p) return { via, errors: ["Cari bulunamadı"] };
  const [{ data: users }, { data: set }, { data: co }] = await Promise.all([
    admin.from("sup_portal_users").select("email").eq("party_id", o.partyId).eq("is_active", true),
    admin.from("pur_settings").select("mail_account_id, cc_email").eq("company_id", p.company_id).maybeSingle(),
    admin.from("companies").select("name, phone").eq("id", p.company_id).maybeSingle(),
  ]);
  const company = (co?.name as string) || "MB Dental";
  const link = `${erpUrl()}${o.path ?? "/tedarikci"}`;

  if (o.email) {
    const to = [...new Set([p.order_email, p.email, ...(users ?? []).map((u) => u.email as string)].map((x) => (x ?? "").trim().toLowerCase()).filter((x) => x.includes("@")))];
    if (!to.length) errors.push("E-posta: tedarikçinin e-posta adresi yok");
    else if (!gmailConfigured() || !set?.mail_account_id) errors.push("E-posta: satın alma ayarlarında gönderen Gmail hesabı seçilmemiş");
    else {
      try {
        const { data: acc } = await admin.from("mail_accounts").select("id, user_id, display_name").eq("id", set.mail_account_id).maybeSingle();
        if (!acc) throw new Error("gönderen hesap bulunamadı");
        const { token, email } = await accessToken(acc.id as string, acc.user_id as string);
        const html = `<div style="font-family:Arial,sans-serif;color:#1d2733;max-width:640px">
<p>Sayın ${esc((p.contact_name as string) || (p.name as string))},</p>
<div style="white-space:pre-wrap;font-size:15px;line-height:1.5">${esc(o.text)}</div>
<p style="margin:24px 0"><a href="${link}" style="background:#0A3D73;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:bold">Tedarikçi ekranında aç</a></p>
<p style="font-size:13px;color:#5b6b7c">Siparişlerinizi, mesajlarınızı, belgelerinizi, carinizi ve ödeme takviminizi tedarikçi ekranından görebilir, yanıtlayabilirsiniz.</p>
<p>Saygılarımızla,<br>${esc(company)}${co?.phone ? `<br>${esc(co.phone as string)}` : ""}</p></div>`;
        await sendMail(token, { from: email, fromName: (acc.display_name as string) || company, to: to.join(", "), ...(set.cc_email ? { cc: set.cc_email as string } : {}), subject: o.subject, html, text: `${o.text}\n\n${link}`, ...(o.attachment ? { attachments: [o.attachment] } : {}) });
        via.push("email");
      } catch (e) {
        errors.push(`E-posta: ${(e as Error).message}`.slice(0, 200));
      }
    }
  }

  if (o.whatsapp) {
    const num = waNumber((p.order_phone as string) || (p.phone as string));
    if (!num) errors.push("WhatsApp: tedarikçinin telefonu yok");
    else if (!waConfigured()) errors.push("WhatsApp: Business API ayarlı değil (WhatsApp'tan aç bağlantısını kullanın)");
    else {
      try {
        await waSendTemplate(num, `${company}: ${o.text.slice(0, 700)} — ${link}`);
        via.push("whatsapp");
      } catch (e) {
        errors.push(`WhatsApp: ${(e as Error).message === "no_template" ? "onaylı şablon tanımlı değil" : (e as Error).message}`.slice(0, 200));
      }
    }
  }
  return { via, errors };
}

/** Kovadaki dosyayı ek olarak indir (e-posta eki için, en çok 10 MB) */
export async function fileAttachment(path: string, name: string, mime: string | null) {
  const { data, error } = await createAdminClient().storage.from("supplier-files").download(path);
  if (error || !data || data.size > 10 * 1024 * 1024) return null;
  return { name, mime: mime || "application/octet-stream", data: Buffer.from(await data.arrayBuffer()) };
}
