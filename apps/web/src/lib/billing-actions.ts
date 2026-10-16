"use server";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { waybillError } from "@/lib/waybill";
import { accessToken, gmailConfigured, sendMail } from "@/lib/gmail";
import { docEmail, docsXlsx, loadStatementDocs, loadWaybillDocs, type DocKind } from "@/lib/billing-docs";

type R = { ok: boolean; message: string };
const UUID = /^[0-9a-f-]{36}$/i;
const day = (v: string) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
const ids = (a: string[]) => a.filter((x) => UUID.test(x)).slice(0, 300);

async function guard() {
  const s = await getSession();
  if (!s.logistics && (s.modules.sales ?? 0) < 2) throw new Error("Yetkiniz yok.");
  return s;
}
function refresh() {
  revalidatePath("/isler/irsaliye", "layout");
  revalidatePath("/isler/aylik-fatura", "layout");
  revalidatePath("/isler/cari");
}

/** Yazdırma / WhatsApp / Excel / e-posta izi */
export async function logDocEvent(kind: DocKind, docIds: string[], action: "print" | "email" | "whatsapp" | "excel", target?: string | null): Promise<void> {
  try {
    const s = await guard();
    const list = ids(docIds);
    if (!list.length) return;
    await createAdminClient().from("lab_doc_events").insert(list.map((id) => ({ company_id: s.companyId, doc_kind: kind, doc_id: id, action, target: target?.slice(0, 200) ?? null, by_user: s.userId })));
  } catch { /* iz isteğe bağlı */ }
}

/** Seçilen irsaliyesiz işlerden müşteri başına irsaliye */
export async function createWaybillsFor(date: string, groups: { customer: string; jobs: string[] }[]): Promise<R & { created?: number }> {
  try { await guard(); } catch (e) { return { ok: false, message: (e as Error).message }; }
  const d = day(date);
  if (!d) return { ok: false, message: "Gün seçin." };
  const sb = await createClient();
  let ok = 0; const errs: string[] = [];
  for (const g of groups) {
    const js = ids(g.jobs);
    if (!UUID.test(g.customer) || !js.length) continue;
    const { error } = await sb.rpc("lab_waybill_create", { p_customer: g.customer, p_date: d, p_jobs: js });
    if (error) errs.push(waybillError(error.message)); else ok++;
  }
  refresh();
  if (!ok) return { ok: false, message: errs[0] ?? "Seçili iş yok." };
  return { ok: true, created: ok, message: `${ok} irsaliye oluşturuldu.${errs.length ? ` ${errs.length} hata: ${errs[0]}` : ""}` };
}

/** Seçilen irsaliyeleri "kesildi" yap */
export async function issueWaybillsIds(list: string[]): Promise<R> {
  try { await guard(); } catch (e) { return { ok: false, message: (e as Error).message }; }
  const sb = await createClient();
  let ok = 0; const errs: string[] = [];
  for (const id of ids(list)) {
    const { error } = await sb.rpc("lab_waybill_issue", { p_id: id });
    if (error) errs.push(waybillError(error.message)); else ok++;
  }
  refresh();
  return { ok: ok > 0 || !errs.length, message: ok ? `${ok} irsaliye kesildi.${errs.length ? ` ${errs.length} hata: ${errs[0]}` : ""}` : errs[0] ?? "Kesilecek irsaliye yok." };
}

/** Müşterilerin dönem içindeki irsaliyesiz teslimlerine irsaliye aç (fatura öncesi) */
export async function backfillLoose(customers: string[], from: string, to: string): Promise<R> {
  try { await guard(); } catch (e) { return { ok: false, message: (e as Error).message }; }
  const f = day(from), t = day(to);
  if (!f || !t) return { ok: false, message: "Dönem seçin." };
  const sb = await createClient();
  let n = 0;
  for (const c of ids(customers)) {
    const { data, error } = await sb.rpc("lab_waybills_backfill", { p_customer: c, p_from: f, p_to: t });
    if (error) return { ok: false, message: waybillError(error.message) };
    n += Number(data ?? 0);
  }
  refresh();
  return { ok: true, message: n ? `${n} irsaliyesiz iş irsaliyeye eklendi.` : "İrsaliyesiz iş yok." };
}

/** Seçilen irsaliyelerle müşteri başına fatura */
export async function createStatementsSel(items: { customer: string; waybills: string[] }[], issue: string, note: string): Promise<R & { created?: string[]; errors?: { customer: string; message: string }[] }> {
  try { await guard(); } catch (e) { return { ok: false, message: (e as Error).message }; }
  const sb = await createClient();
  const created: string[] = []; const errors: { customer: string; message: string }[] = [];
  for (const it of items) {
    const wb = ids(it.waybills);
    if (!UUID.test(it.customer) || !wb.length) continue;
    const { data, error } = await sb.rpc("lab_statement_create_sel", { p_customer: it.customer, p_waybills: wb, p_issue: day(issue), p_note: note.trim().slice(0, 300) || null });
    if (error) errors.push({ customer: it.customer, message: /lab_statement_create_sel|schema cache/.test(error.message) ? "Supabase'de mbdental-fatura-sihirbazi.sql çalıştırılmalı." : /mixed_currency/.test(error.message) ? "Seçilen irsaliyelerin para birimi farklı." : /waybill_not_available/.test(error.message) ? "Seçilen irsaliyelerden biri iptal edilmiş ya da zaten faturalanmış." : waybillError(error.message) });
    else created.push(data as string);
  }
  refresh();
  if (!created.length) return { ok: false, message: errors[0]?.message ?? "Seçili irsaliye yok.", errors };
  return { ok: true, created, errors, message: `${created.length} fatura kesildi.${errors.length ? ` ${errors.length} müşteride hata var.` : ""}` };
}

/** Belgeleri müşterinin e-posta adresine gönder (Excel ekli). Gönderen: kullanıcının bağlı e-posta hesabı, yoksa şirketteki ilk hesap */
export async function emailDocs(kind: DocKind, list: string[]): Promise<R & { results?: { id: string; ok: boolean; message: string }[] }> {
  let s;
  try { s = await guard(); } catch (e) { return { ok: false, message: (e as Error).message }; }
  if (!gmailConfigured()) return { ok: false, message: "E-posta gönderimi kurulu değil (E-posta modülünde Gmail bağlantısı)." };
  const admin = createAdminClient();
  const { data: accs } = await admin.from("mail_accounts").select("id, user_id, display_name, email").eq("company_id", s.companyId).eq("status", "active").order("created_at");
  const acc = (accs ?? []).find((a) => a.user_id === s.userId) ?? (accs ?? [])[0];
  if (!acc) return { ok: false, message: "Bağlı e-posta hesabı yok. E-posta modülünden Gmail hesabı bağlayın." };
  let token: string, from: string;
  try { ({ token, email: from } = await accessToken(acc.id as string, acc.user_id as string)); } catch (e) { return { ok: false, message: `E-posta hesabı: ${(e as Error).message}` }; }
  const sb = await createClient();
  const docs = kind === "waybill" ? await loadWaybillDocs(sb, ids(list)) : await loadStatementDocs(sb, ids(list));
  const [{ data: co }, { data: banks }] = await Promise.all([
    admin.from("companies").select("name").eq("id", s.companyId).maybeSingle(),
    sb.from("lab_options").select("value").eq("kind", "bank").order("sort"),
  ]);
  const company = (co?.name as string) || s.companyName || "MB Dental";
  const results: { id: string; ok: boolean; message: string }[] = [];
  for (const d of docs) {
    const to = (d.customer?.email ?? "").trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to.split(/[;,]/)[0]?.trim() ?? "")) { results.push({ id: d.id, ok: false, message: `${d.customer?.name ?? ""}: e-posta adresi yok` }); continue; }
    try {
      const m = docEmail(d, company, (banks ?? []).map((b) => b.value as string));
      const xlsx = await docsXlsx([d]);
      await sendMail(token, { from, fromName: (acc.display_name as string) || company, to: to.replace(/;/g, ","), subject: m.subject, html: m.html, text: m.text, attachments: [{ name: `${d.no}.xlsx`, mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", data: xlsx }] });
      await admin.from("lab_doc_events").insert({ company_id: s.companyId, doc_kind: kind, doc_id: d.id, action: "email", target: to.slice(0, 200), by_user: s.userId });
      results.push({ id: d.id, ok: true, message: `${d.customer?.name ?? ""}: gönderildi (${to})` });
    } catch (e) {
      results.push({ id: d.id, ok: false, message: `${d.customer?.name ?? ""}: ${(e as Error).message}`.slice(0, 200) });
    }
  }
  refresh();
  const ok = results.filter((r) => r.ok).length;
  return { ok: ok > 0, results, message: `${ok} e-posta gönderildi${results.length - ok ? `, ${results.length - ok} gönderilemedi` : ""}. Gönderen: ${from}` };
}
