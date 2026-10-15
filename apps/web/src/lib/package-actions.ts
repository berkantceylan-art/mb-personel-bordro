"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSession } from "@/lib/session";
import { done, fail } from "@/lib/flash";
import { glError } from "@/lib/gl";
import { accessToken, gmailConfigured, sendMail } from "@/lib/gmail";
import { PACKAGE_PARTS, buildPackage } from "@/lib/gl-package";

const str = (f: FormData, k: string, max = 500) => String(f.get(k) ?? "").trim().slice(0, max);
const emails = (s: string) => s.split(/[,;\s]+/).map((x) => x.trim()).filter((x) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x));
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

async function need(level: number) {
  const s = await getSession();
  if ((s.modules.ledger ?? 0) < level) await fail("Bu işlem için genel muhasebe onay yetkisi gerekir (yönetici / mali müşavir).");
  return s;
}

export async function glPackageSettings(f: FormData) {
  await need(3);
  const to = emails(str(f, "to"));
  const cc = emails(str(f, "cc"));
  if (!to.length) await fail("Mali müşavirin e-posta adresini yazın.");
  const supabase = await createClient();
  const { error } = await supabase.rpc("gl_package_settings_save", { p: { to_emails: to.join(", "), cc_emails: cc.join(", "), mail_account_id: str(f, "account", 40), message: str(f, "message", 1000) } });
  if (error) await fail(glError(error.message));
  revalidatePath("/muhasebe/paket");
  await done("Paket gönderim ayarları kaydedildi.");
}

/** Paketi oluşturup mali müşavire e-postayla gönderir (Gmail hesabından, ZIP ek olarak) */
export async function glPackageEmail(f: FormData) {
  await need(3);
  const month = str(f, "month", 7);
  if (!/^\d{4}-\d{2}$/.test(month)) await fail("Ay seçin.");
  const parts = f.getAll("p").map(String).filter((p) => PACKAGE_PARTS.some(([k]) => k === p));
  if (!parts.length) await fail("Pakete en az bir rapor seçin.");
  const supabase = await createClient();
  const { data: set } = await supabase.from("gl_package_settings").select("to_emails, cc_emails, mail_account_id, message").maybeSingle();
  if (!set?.to_emails) await fail("Önce alıcı e-posta adresini kaydedin.");
  if (!set?.mail_account_id) await fail("Gönderen e-posta hesabını seçip kaydedin (E-posta modülünde bağlı Gmail hesabı).");
  if (!gmailConfigured()) await fail("E-posta gönderimi ayarlı değil (Gmail bağlantısı).");
  const { data: co } = await supabase.from("companies").select("name").limit(1).maybeSingle();
  const company = (co?.name as string) || "MB Dental";
  const pkg = await buildPackage(supabase, month, company, parts);
  const log = (err: string | null) => supabase.rpc("gl_package_log", { p_period: month, p_kind: "email", p_to: set!.to_emails, p_files: pkg.files, p_size: pkg.zip.length, p_error: err });
  if (pkg.zip.length > 18 * 1024 * 1024) {
    await log("Paket 18 MB'tan büyük");
    await fail(`Paket ${(pkg.zip.length / 1048576).toFixed(1)} MB; e-posta eki sınırını aşıyor. Paketi indirip paylaşın ya da Luca dosyalarını çıkarıp tekrar deneyin.`);
  }
  try {
    const admin = createAdminClient();
    const { data: acc } = await admin.from("mail_accounts").select("id, user_id, display_name").eq("id", set!.mail_account_id).maybeSingle();
    if (!acc) throw new Error("Gönderen e-posta hesabı bulunamadı");
    const { token, email } = await accessToken(acc.id as string, acc.user_id as string);
    const list = pkg.files.map((n) => `<li>${esc(n)}</li>`).join("");
    const note = set!.message ? `<p>${esc(set!.message).replace(/\n/g, "<br>")}</p>` : "";
    const html = `<div style="font-family:Arial,sans-serif;color:#1d2733;max-width:640px"><p>Merhaba,</p>${note}<p>${esc(company)} — <b>${month}</b> dönemi muhasebe paketi ektedir.</p><ul>${list}</ul>${pkg.errors.length ? `<p style="color:#9a3412">Not: bazı raporlar üretilemedi, ayrıntı pakette UYARILAR.txt dosyasında.</p>` : ""}<p>Saygılarımızla,<br>${esc(company)}</p></div>`;
    const text = `${company} — ${month} dönemi muhasebe paketi ektedir.\n\n${set!.message ?? ""}\n\nDosyalar:\n${pkg.files.map((n) => `- ${n}`).join("\n")}`;
    await sendMail(token, { from: email, fromName: (acc.display_name as string) || company, to: set!.to_emails as string, ...(set!.cc_emails ? { cc: set!.cc_emails as string } : {}), subject: `${company} ${month} muhasebe paketi`, html, text, attachments: [{ name: pkg.name, mime: "application/zip", data: pkg.zip }] });
  } catch (e) {
    const m = (e as Error).message.slice(0, 300);
    await log(m);
    revalidatePath("/muhasebe/paket");
    return await fail(`E-posta gönderilemedi: ${m}`);
  }
  await log(null);
  revalidatePath("/muhasebe", "layout");
  await done(`${month} paketi ${set!.to_emails} adresine gönderildi (${pkg.files.length} dosya).`);
}
