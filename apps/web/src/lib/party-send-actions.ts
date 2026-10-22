"use server";
import { createClient } from "@/lib/supabase/server";
import { getSession, formatDate } from "@/lib/session";
import { accessToken, GmailError, sendMail } from "@/lib/gmail";
import { partyLedger } from "@/lib/fin-data";
import { dateOk, fmt, type Party } from "@/lib/fin";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const ADDR = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;
const ID = /^[0-9a-f-]{36}$/i;
/** E-postaya en çok bu kadar satır konur; fazlası "devir" satırında toplanır */
const MAX_ROWS = 300;

/** Cari ekstresini (tarih aralığıyla) kullanıcının bağlı Gmail hesabından e-postayla gönderir */
export async function sendPartyStatementMail(f: FormData): Promise<{ ok: boolean; message: string }> {
  try {
    const s = await getSession();
    if (!["finance", "sales", "purchases"].some((m) => (s.modules[m] ?? 0) >= 1)) return { ok: false, message: "Yetkiniz yok." };
    const partyId = String(f.get("party") ?? "");
    const account = String(f.get("account") ?? "");
    if (!ID.test(partyId)) return { ok: false, message: "Cari bulunamadı." };
    if (!ID.test(account)) return { ok: false, message: "Gönderen e-posta hesabını seçin." };
    const to = String(f.get("to") ?? "").split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean);
    if (!to.length) return { ok: false, message: "Alıcı e-posta adresini yazın." };
    const bad = to.find((x) => !ADDR.test(x));
    if (bad) return { ok: false, message: `Geçersiz adres: ${bad}` };
    const note = String(f.get("note") ?? "").slice(0, 4000).trim();
    let from = dateOk(String(f.get("bas") ?? ""));
    const until = dateOk(String(f.get("bit") ?? ""));

    const supabase = await createClient();
    const { data } = await supabase.from("fin_parties").select("*").eq("id", partyId).maybeSingle();
    if (!data) return { ok: false, message: "Cari bulunamadı." };
    const p = data as Party;
    let led = await partyLedger(p, from, until);
    // çok uzun ekstre: son MAX_ROWS hareket, öncesi devir olarak
    if (led.rows.length > MAX_ROWS + 1) {
      from = led.rows[led.rows.length - MAX_ROWS]!.date;
      led = await partyLedger(p, from, until);
    }
    const [{ data: co }, { data: acc }] = await Promise.all([
      supabase.from("companies").select("name, phone, address").eq("id", s.companyId).maybeSingle(),
      supabase.from("mail_accounts").select("display_name, signature").eq("id", account).maybeSingle(),
    ]);
    const company = (co?.name as string) || "MB Dental";
    const today = new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10);
    const period = `${from ? formatDate(from) : "başlangıç"} – ${formatDate(until ?? today)}`;
    const m = (v: number) => fmt(v, p.currency);
    const side = led.balance > 0 ? "Bize borç bakiyeniz" : led.balance < 0 ? "Alacak bakiyeniz" : "Bakiye";
    const td = "padding:5px 8px;border-bottom:1px solid #e5e9ee";
    const rows = led.rows.map((r) => `<tr><td style="${td};white-space:nowrap">${r.date ? formatDate(r.date) : ""}</td><td style="${td}">${esc(r.label || "")}</td><td style="${td};text-align:right;white-space:nowrap">${r.debit ? m(r.debit) : ""}</td><td style="${td};text-align:right;white-space:nowrap">${r.credit ? m(r.credit) : ""}</td><td style="${td};text-align:right;white-space:nowrap">${m(r.balance)}</td></tr>`).join("");
    const sig = (acc?.signature as string | null)?.trim() ?? "";
    const html = `<div style="font-family:Arial,sans-serif;color:#1d2733;max-width:760px;font-size:14px">
<p>Sayın ${esc(p.contact_name || p.name)},</p>
${note ? `<div style="white-space:pre-wrap;line-height:1.5">${esc(note)}</div>` : `<p>${esc(company)} nezdindeki cari hesap ekstreniz aşağıdadır.</p>`}
<p style="font-size:16px;font-weight:bold;margin:18px 0 6px">Cari hesap ekstresi · ${esc(p.name)}</p>
<p style="margin:0 0 8px;color:#5b6b7c">Dönem: ${period} · Para birimi: ${p.currency}</p>
<table style="border-collapse:collapse;width:100%;font-size:13px"><thead><tr style="background:#f3f6f9;text-align:left"><th style="padding:6px 8px">Tarih</th><th style="padding:6px 8px">Açıklama</th><th style="padding:6px 8px;text-align:right">Borç</th><th style="padding:6px 8px;text-align:right">Alacak</th><th style="padding:6px 8px;text-align:right">Bakiye</th></tr></thead>
<tbody>${rows}</tbody>
<tfoot><tr style="font-weight:bold"><td colspan="2" style="padding:6px 8px;text-align:right">Toplam</td><td style="padding:6px 8px;text-align:right">${m(led.debit)}</td><td style="padding:6px 8px;text-align:right">${m(led.credit)}</td><td style="padding:6px 8px;text-align:right">${m(led.balance)}</td></tr></tfoot></table>
<p style="font-size:15px;font-weight:bold;margin:16px 0">${side}: ${fmt(Math.abs(led.balance), p.currency)}</p>
<p style="font-size:12px;color:#5b6b7c">Kayıtlarınızla farklılık varsa lütfen bize bildiriniz.</p>
<p>Saygılarımızla,<br>${esc(company)}${co?.phone ? `<br>${esc(co.phone as string)}` : ""}</p>${sig ? `<div style="color:#555;font-size:13px">${esc(sig).replace(/\n/g, "<br>")}</div>` : ""}</div>`;
    const text = `${note || `${company} nezdindeki cari hesap ekstreniz.`}\n\nCari: ${p.name}\nDönem: ${period}\n${side}: ${fmt(Math.abs(led.balance), p.currency)}\n\n${led.rows.map((r) => `${r.date ? formatDate(r.date) : ""}  ${r.label}  ${r.debit ? `B ${m(r.debit)}` : ""}${r.credit ? `A ${m(r.credit)}` : ""}  = ${m(r.balance)}`).join("\n")}\n\n${company}`;
    const { token, email } = await accessToken(account, s.userId);
    await sendMail(token, { from: email, fromName: (acc?.display_name as string) || company, to: to.join(", "), subject: `${company} · Cari hesap ekstresi · ${p.name}`, html, text });
    return { ok: true, message: `Ekstre ${to.join(", ")} adresine gönderildi${led.rows.length > MAX_ROWS ? ` (son ${MAX_ROWS} hareket, öncesi devir olarak)` : ""}.` };
  } catch (e) {
    if (e instanceof GmailError) return { ok: false, message: e.status === 403 ? "Gmail izinleri eksik; Posta ekranından hesabı yeniden bağlayın." : e.message.slice(0, 200) };
    return { ok: false, message: ((e as Error).message ?? "Hata").slice(0, 200) };
  }
}
