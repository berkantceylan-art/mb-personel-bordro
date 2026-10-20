"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSession } from "@/lib/session";
import { accessToken, getAttachment, getMessageAttachments, gmailConfigured, isQuotaError, listMessageIds } from "@/lib/gmail";
import { parseCarrierFile, type CarrierInvoice } from "@/lib/carrier-parse";

type Res = { ok: boolean; message: string; lines?: string[] };
const missing = (m: string) => (/carrier_|schema cache/i.test(m) ? "Önce mbdental-kargo-fatura.sql dosyasını Supabase'de çalıştırın." : m);
const tl = (k: number) => (k / 100).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const MAIL_FROM = "2026-01-01";
const CARRIER_MAIL_QUERY = `has:attachment after:${MAIL_FROM.replace(/-/g, "/")} (from:dhl.com OR from:ups.com OR from:finansaltalepler@dhl.com OR from:upstrfaturalama@ups.com)`;

async function guard() {
  const s = await getSession();
  if (!s.logistics && (s.modules.finance ?? 0) < 2) throw new Error("Kargo faturaları için yetkiniz yok.");
  return s;
}

async function save(inv: CarrierInvoice, extra: { source: "upload" | "mail"; file_name: string; mail_ref?: string; detail_only?: boolean }) {
  const sb = await createClient();
  const { data, error } = await sb.rpc("carrier_invoice_save", { p: { ...inv, ...extra } });
  if (error) throw new Error(missing(error.message));
  return data as { id: string; items: number };
}

const label = (inv: CarrierInvoice, items: number) =>
  `${inv.carrier.toUpperCase()} ${inv.invoice_no}${inv.total ? ` · ${tl(inv.total)} ₺` : ""}${items ? ` · ${items} gönderi` : inv.carrier === "ups" ? " · gönderi ayrıntısı bekleniyor (Fatura Detay Excel'i yükleyin)" : ""}`;

/** PDF (DHL / UPS fatura) ve Excel (UPS Fatura Detay) yükle */
export async function uploadCarrierFiles(f: FormData): Promise<Res> {
  try {
    await guard();
    const files = f.getAll("files").filter((x): x is File => x instanceof File && x.size > 0);
    if (!files.length) return { ok: false, message: "Dosya seçin." };
    const lines: string[] = [];
    let bad = 0;
    for (const file of files.slice(0, 30)) {
      if (file.size > 15 * 1024 * 1024) { lines.push(`${file.name}: dosya çok büyük`); bad++; continue; }
      try {
        const inv = await parseCarrierFile(file.name, new Uint8Array(await file.arrayBuffer()));
        const r = await save(inv, { source: "upload", file_name: file.name, detail_only: /\.xlsx?$/i.test(file.name) });
        lines.push(`✓ ${file.name}: ${label(inv, r.items)}`);
      } catch (e) { bad++; lines.push(`✗ ${file.name}: ${(e as Error).message}`); }
    }
    revalidatePath("/kargo/faturalar");
    return { ok: bad === 0, message: `${files.length - bad} dosya işlendi${bad ? `, ${bad} dosya okunamadı` : ""}.`, lines };
  } catch (e) { return { ok: false, message: (e as Error).message }; }
}

/** Bağlı Gmail kutusundan DHL / UPS faturalarını çek (banka e-postası için seçilen hesap) */
export async function fetchCarrierMail(): Promise<Res> {
  try {
    await guard();
    if (!gmailConfigured()) return { ok: false, message: "Gmail bağlantısı ayarlı değil." };
    const admin = createAdminClient();
    const sb = await createClient();
    const { data: set } = await sb.from("fin_bank_mail_settings").select("mail_account_id").limit(1).maybeSingle();
    if (!set?.mail_account_id) return { ok: false, message: "Taranacak e-posta hesabı seçilmemiş (Finans › Banka e-postası ayarından seçilir)." };
    const { data: acc } = await admin.from("mail_accounts").select("id, user_id").eq("id", set.mail_account_id).maybeSingle();
    if (!acc) return { ok: false, message: "E-posta hesabı bulunamadı." };
    const token = (await accessToken(acc.id as string, acc.user_id as string)).token;
    const ids: string[] = [];
    let next: string | null = null;
    do {
      const r = await listMessageIds(token, { q: CARRIER_MAIL_QUERY, max: 50, ...(next ? { pageToken: next } : {}) });
      ids.push(...r.ids); next = r.next;
    } while (next && ids.length < 1000);
    const { data: seen } = await sb.from("carrier_invoices").select("mail_ref").not("mail_ref", "is", null);
    const done = new Set(((seen ?? []) as { mail_ref: string }[]).map((x) => x.mail_ref.split(":")[0]));
    const todo = ids.filter((i) => !done.has(i)).slice(0, 25);
    const lines: string[] = [];
    let n = 0;
    for (const id of todo) {
      try {
        const m = await getMessageAttachments(token, id);
        for (const a of m.attachments.filter((x) => /\.(pdf|xlsx?)$/i.test(x.name)).slice(0, 6)) {
          try {
            const buf = await getAttachment(token, m.id, a.id);
            const inv = await parseCarrierFile(a.name, new Uint8Array(buf));
            if (inv.invoice_date && inv.invoice_date < MAIL_FROM) continue;   // 01.01.2026 öncesi alınmaz
            const r = await save(inv, { source: "mail", file_name: a.name, mail_ref: `${id}:${a.name}`.slice(0, 300), detail_only: /\.xlsx?$/i.test(a.name) });
            lines.push(`✓ ${label(inv, r.items)}`); n++;
          } catch { /* fatura olmayan ek */ }
        }
      } catch (e) {
        if (isQuotaError(e)) { lines.push("Gmail kotası doldu; biraz sonra tekrar deneyin."); break; }
        lines.push(`✗ ${(e as Error).message}`.slice(0, 160));
      }
    }
    revalidatePath("/kargo/faturalar");
    return { ok: true, message: `${todo.length} e-posta incelendi, ${n} fatura alındı${ids.length > todo.length + done.size ? " (kalanlar için tekrar basın)" : ""}.`, lines };
  } catch (e) { return { ok: false, message: missing((e as Error).message) }; }
}

export async function rematchCarrier(): Promise<Res> {
  try {
    await guard();
    const { data, error } = await (await createClient()).rpc("carrier_rematch");
    if (error) return { ok: false, message: missing(error.message) };
    revalidatePath("/kargo/faturalar");
    return { ok: true, message: `${Number(data ?? 0)} satır yeniden eşleştirildi.` };
  } catch (e) { return { ok: false, message: (e as Error).message }; }
}

/** İtiraz işareti (satır) */
export async function toggleDispute(f: FormData) {
  await guard();
  const id = String(f.get("id") ?? "");
  const sb = await createClient();
  const { data } = await sb.from("carrier_invoice_items").select("disputed, invoice_id").eq("id", id).maybeSingle();
  if (!data) return;
  await sb.from("carrier_invoice_items").update({ disputed: !data.disputed, note: String(f.get("note") ?? "").slice(0, 500) || null }).eq("id", id);
  revalidatePath(`/kargo/faturalar/${data.invoice_id}`);
  revalidatePath("/kargo/faturalar");
}

export async function setCarrierInvoiceStatus(f: FormData) {
  await guard();
  const id = String(f.get("id") ?? "");
  const st = String(f.get("status") ?? "");
  if (!["open", "checked", "disputed"].includes(st)) return;
  await (await createClient()).from("carrier_invoices").update({ status: st }).eq("id", id);
  revalidatePath(`/kargo/faturalar/${id}`);
  revalidatePath("/kargo/faturalar");
}
