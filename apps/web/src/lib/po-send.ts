import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { accessToken, sendMail, gmailConfigured } from "@/lib/gmail";
import { waConfigured, waSendTemplate } from "@/lib/whatsapp";
import { waNumber } from "@/lib/wa";
import { money } from "@/lib/jobs";

export const erpUrl = () => (process.env.NEXT_PUBLIC_ERP_URL || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "")).replace(/\/+$/, "");
export const supplierLink = (token: string) => `${erpUrl()}/tedarikci/siparis/${token}`;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const dt = (d: string | null) => (d ? d.split("-").reverse().join(".") : "");

type Order = {
  id: string; company_id: string; year: number; no: number; order_date: string; expected_date: string | null; currency: string; subtotal: number; vat_total: number; total: number; note: string | null;
  supplier_token: string; send_attempts: number;
  fin_parties: { name: string; email: string | null; phone: string | null; order_email: string | null; order_phone: string | null; contact_name: string | null } | null;
};

/** Onaylanmış ve gönderim kuyruğundaki siparişleri tedarikçiye e-posta + WhatsApp ile gönderir. */
export async function sendQueuedPOs(max = 10): Promise<{ sent: number; failed: number }> {
  let admin;
  try { admin = createAdminClient(); } catch { return { sent: 0, failed: 0 }; }
  const { data } = await admin.from("pur_orders").select("id").eq("send_state", "queued").lt("send_attempts", 5).order("approved_at").limit(max);
  let sent = 0;
  let failed = 0;
  for (const r of data ?? []) {
    const ok = await sendPO(r.id as string);
    if (ok) sent++; else failed++;
  }
  return { sent, failed };
}

export async function sendPO(id: string): Promise<boolean> {
  const admin = createAdminClient();
  const { data: o } = await admin.from("pur_orders")
    .select("id, company_id, year, no, order_date, expected_date, currency, subtotal, vat_total, total, note, supplier_token, send_attempts, fin_parties(name, email, phone, order_email, order_phone, contact_name)")
    .eq("id", id).maybeSingle();
  if (!o) return false;
  const po = o as unknown as Order;
  const [{ data: lines }, { data: co }, { data: set }] = await Promise.all([
    admin.from("pur_order_lines").select("name, qty, unit, unit_price, amount").eq("order_id", id).order("sort"),
    admin.from("companies").select("name, phone, email, address, city").eq("id", po.company_id).maybeSingle(),
    admin.from("pur_settings").select("send_whatsapp, mail_account_id, cc_email").eq("company_id", po.company_id).maybeSingle(),
  ]);
  const party = po.fin_parties;
  const no = `SA-${po.year}-${String(po.no).padStart(4, "0")}`;
  const link = supplierLink(po.supplier_token);
  const company = (co?.name as string) || "MB Dental";
  const to = (party?.order_email || party?.email || "").trim();
  const phone = party?.order_phone || party?.phone || "";
  const via: string[] = [];
  const errors: string[] = [];

  // E-posta (satın alma ayarlarında seçilen Gmail hesabından)
  if (to && set?.mail_account_id && gmailConfigured()) {
    try {
      const { data: acc } = await admin.from("mail_accounts").select("id, user_id, display_name").eq("id", set.mail_account_id).maybeSingle();
      if (!acc) throw new Error("Gönderen e-posta hesabı bulunamadı");
      const { token, email } = await accessToken(acc.id as string, acc.user_id as string);
      const rows = (lines ?? []).map((l) => `<tr><td style="padding:6px 8px;border-bottom:1px solid #eee">${esc(l.name as string)}</td><td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right">${Number(l.qty)} ${esc(l.unit as string)}</td><td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right">${money(l.unit_price as number, po.currency)}</td><td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right">${money(l.amount as number, po.currency)}</td></tr>`).join("");
      const html = `<div style="font-family:Arial,sans-serif;color:#1d2733;max-width:680px">
<p>Sayın ${esc(party?.contact_name || party?.name || "Yetkili")},</p>
<p>${esc(company)} olarak aşağıdaki siparişi veriyoruz.${po.expected_date ? ` İstenen teslim tarihi: <b>${dt(po.expected_date)}</b>.` : ""}</p>
<p style="font-size:18px;font-weight:bold;margin:16px 0 8px">Sipariş ${no} · ${dt(po.order_date)}</p>
<table style="border-collapse:collapse;width:100%;font-size:14px"><thead><tr style="background:#f3f6f9;text-align:left"><th style="padding:6px 8px">Kalem</th><th style="padding:6px 8px;text-align:right">Miktar</th><th style="padding:6px 8px;text-align:right">Birim fiyat</th><th style="padding:6px 8px;text-align:right">Tutar</th></tr></thead><tbody>${rows}</tbody>
<tfoot><tr><td colspan="3" style="padding:6px 8px;text-align:right">KDV hariç</td><td style="padding:6px 8px;text-align:right">${money(po.subtotal, po.currency)}</td></tr><tr><td colspan="3" style="padding:6px 8px;text-align:right">KDV</td><td style="padding:6px 8px;text-align:right">${money(po.vat_total, po.currency)}</td></tr><tr><td colspan="3" style="padding:6px 8px;text-align:right;font-weight:bold">Toplam</td><td style="padding:6px 8px;text-align:right;font-weight:bold">${money(po.total, po.currency)}</td></tr></tfoot></table>
${po.note ? `<p><b>Not:</b> ${esc(po.note)}</p>` : ""}
<p style="margin:24px 0"><a href="${link}" style="background:#0A3D73;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:bold">Siparişi görüntüle ve onayla</a></p>
<p style="font-size:13px;color:#5b6b7c">Bağlantıdan siparişi aldığınızı ve termin tarihini bildirebilir, sevk ettiğinizde irsaliye numarasını girebilirsiniz. Yazdırmak için de aynı sayfayı kullanabilirsiniz.</p>
<p>Saygılarımızla,<br>${esc(company)}${co?.phone ? `<br>${esc(co.phone as string)}` : ""}</p></div>`;
      const text = `${company} — Sipariş ${no} (${dt(po.order_date)})\n\n${(lines ?? []).map((l) => `- ${l.name}: ${Number(l.qty)} ${l.unit}`).join("\n")}\n\nToplam: ${money(po.total, po.currency)}\n\nSiparişi görüntüleyip onaylamak için: ${link}`;
      await sendMail(token, { from: email, fromName: (acc.display_name as string) || company, to, ...(set.cc_email ? { cc: set.cc_email as string } : {}), subject: `${company} satın alma siparişi ${no}`, html, text });
      via.push("email");
    } catch (e) {
      errors.push(`E-posta: ${(e as Error).message}`.slice(0, 200));
    }
  } else if (!to) errors.push("Tedarikçinin e-posta adresi yok");
  else if (!set?.mail_account_id) errors.push("Satın alma ayarlarında gönderen e-posta hesabı seçilmemiş");

  // WhatsApp (Business Cloud API, onaylı şablon)
  const num = waNumber(phone);
  if (set?.send_whatsapp !== false && num && waConfigured()) {
    try {
      await waSendTemplate(num, `${company} satın alma siparişi ${no}: ${(lines ?? []).length} kalem, toplam ${money(po.total, po.currency)}.${po.expected_date ? ` İstenen teslim ${dt(po.expected_date)}.` : ""} Görüntüleyip onaylamak için: ${link}`);
      via.push("whatsapp");
    } catch (e) {
      errors.push(`WhatsApp: ${(e as Error).message === "no_template" ? "onaylı şablon tanımlı değil" : (e as Error).message}`.slice(0, 200));
    }
  }

  const ok = via.length > 0;
  await admin.from("pur_orders").update({
    send_state: ok ? "sent" : "failed",
    send_error: errors.length ? errors.join(" · ").slice(0, 500) : null,
    send_attempts: po.send_attempts + 1,
    ...(ok ? { sent_via: via, sent_at: new Date().toISOString() } : {}),
  }).eq("id", id);
  if (ok) await admin.from("pur_orders").update({ status: "sent" }).eq("id", id).eq("status", "approved");
  return ok;
}

/** Tedarikçi kullanıcı davetini satın alma ayarlarındaki Gmail hesabından gönderir; gönderilemezse hata metni döner */
export async function sendSupplierInvite(companyId: string, to: string, name: string, link: string): Promise<string | null> {
  if (!gmailConfigured()) return "Gmail bağlantısı yapılandırılmamış";
  const admin = createAdminClient();
  const [{ data: set }, { data: co }] = await Promise.all([
    admin.from("pur_settings").select("mail_account_id").eq("company_id", companyId).maybeSingle(),
    admin.from("companies").select("name").eq("id", companyId).maybeSingle(),
  ]);
  if (!set?.mail_account_id) return "Satın alma ayarlarında gönderen e-posta hesabı seçilmemiş";
  try {
    const { data: acc } = await admin.from("mail_accounts").select("id, user_id, display_name").eq("id", set.mail_account_id).maybeSingle();
    if (!acc) return "Gönderen e-posta hesabı bulunamadı";
    const { token, email } = await accessToken(acc.id as string, acc.user_id as string);
    const company = (co?.name as string) || "MB Dental";
    await sendMail(token, {
      from: email, fromName: (acc.display_name as string) || company, to,
      subject: `${company} tedarikçi ekranı daveti`,
      html: `<div style="font-family:Arial,sans-serif;color:#1d2733;max-width:600px"><p>Sayın ${esc(name)},</p><p>${esc(company)} olarak size verdiğimiz siparişleri tek ekrandan görmeniz, onaylamanız ve sevkiyatı bildirmeniz için tedarikçi hesabı açtık.</p><p style="margin:24px 0"><a href="${link}" style="background:#0A3D73;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:bold">Şifremi belirle ve gir</a></p><p style="font-size:13px;color:#5b6b7c">Bağlantı 14 gün geçerlidir.</p><p>Saygılarımızla,<br>${esc(company)}</p></div>`,
      text: `${company} tedarikçi ekranı daveti: ${link} (14 gün geçerli)`,
    });
    return null;
  } catch (e) {
    return (e as Error).message.slice(0, 200);
  }
}
