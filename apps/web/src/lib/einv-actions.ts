"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSession } from "@/lib/session";
import { done, fail } from "@/lib/flash";
import { ownVkn, rowFromXml, scanMailbox, xmlsFromFile, type EinvRow } from "@/lib/einv";
import { parseDespatch } from "@/lib/ubl";

const str = (f: FormData, k: string, max = 300) => String(f.get(k) ?? "").trim().slice(0, max);
const again = () => revalidatePath("/alis/gelen-efatura");

async function need() {
  const s = await getSession();
  if ((s.modules.purchases ?? 0) < 2) await fail("Bu işlem için alış (düzenleme) yetkisi gerekir.");
  return s;
}
const msg = (m: string) => (/not_allowed/.test(m) ? "Yetkiniz yok." : /relation|does not exist|schema cache|function/.test(m) ? "Supabase'de 20270225000000_einv_inbox.sql çalıştırılmalı." : m);

/** XML / ZIP yükle → gelen kutusuna ekle */
export async function einvUpload(f: FormData) {
  await need();
  const files = f.getAll("files").filter((x): x is File => x instanceof File && x.size > 0);
  if (!files.length) await fail("XML ya da ZIP dosyası seçin.");
  const supabase = await createClient();
  const vkn = await ownVkn(supabase);
  const rows: EinvRow[] = [];
  const errs: string[] = [];
  let skipped = 0;
  for (const file of files.slice(0, 50)) {
    if (file.size > 30 * 1024 * 1024) { errs.push(`${file.name}: 30 MB'tan büyük`); continue; }
    try {
      for (const x of await xmlsFromFile(file.name, Buffer.from(await file.arrayBuffer()))) {
        try { const r = rowFromXml(x.xml, vkn, null); if (r) { if (!rows.some((y) => y.ettn === r.ettn)) rows.push(r); } else skipped++; } catch (e) { errs.push(`${x.name}: ${(e as Error).message}`.slice(0, 120)); }
      }
    } catch (e) { errs.push(`${file.name}: ${(e as Error).message}`.slice(0, 120)); }
  }
  if (!rows.length) await fail(`Dosyalarda gelen e-fatura bulunamadı.${skipped ? ` ${skipped} dosya e-fatura değil ya da kendi kestiğiniz fatura.` : ""}${errs.length ? ` ${errs[0]}` : ""}`);
  let added = 0, dup = 0, imp = 0;
  for (let i = 0; i < rows.length; i += 25) {
    const { data, error } = await supabase.rpc("einv_inbox_add", { p_rows: rows.slice(i, i + 25), p_source: "upload" });
    if (error) await fail(msg(error.message));
    const d = data as { added: number; duplicate: number; already_imported: number };
    added += d.added; dup += d.duplicate; imp += d.already_imported;
  }
  again();
  await done(`${added} yeni e-fatura eklendi${dup ? `, ${dup} tanesi zaten kutudaydı` : ""}${imp ? `, ${imp} tanesi daha önce alışa aktarılmış` : ""}.${errs.length ? ` ${errs.length} dosya okunamadı.` : ""}`);
}

export async function einvScanMail() {
  await need();
  const supabase = await createClient();
  let admin;
  try { admin = createAdminClient(); } catch { return await fail("Sunucu anahtarı ayarlı değil."); }
  let r;
  try { r = await scanMailbox(supabase, admin); } catch (e) { return await fail(`E-posta taranamadı: ${(e as Error).message}`.slice(0, 280)); }
  again();
  if (!r.ok) await fail(msg(r.message));
  await done(r.message);
}

export async function einvSetStatus(f: FormData) {
  await need();
  const supabase = await createClient();
  const st = str(f, "status", 20);
  const { error } = await supabase.rpc("einv_set_status", { p_id: str(f, "id", 40), p_status: st, p_note: str(f, "note", 300) || null });
  if (error) await fail(msg(error.message));
  again();
  await done(st === "new" ? "Fatura yeniden bekleyenlere alındı." : st === "rejected" ? "Reddedildi olarak işaretlendi (entegratör portalında da reddetmeyi unutmayın)." : "Yok sayıldı.");
}

export async function einvSettings(f: FormData) {
  await need();
  const supabase = await createClient();
  const { error } = await supabase.rpc("einv_settings_save", { p: { mail_account_id: str(f, "account", 40), mail_query: str(f, "query", 300) } });
  if (error) await fail(msg(error.message));
  again();
  await done("E-posta tarama ayarı kaydedildi.");
}

/** Tarayıcıda okunan XML'ler (parça parça gönderilir; Vercel istek sınırı 4,5 MB) */
export async function einvAddXmls(xmls: Array<{ name: string; xml: string }>): Promise<{ ok: boolean; message: string; added: number; duplicate: number; imported: number; skipped: number; errors: string[] }> {
  const s = await getSession();
  if ((s.modules.purchases ?? 0) < 2) return { ok: false, message: "Yetkiniz yok.", added: 0, duplicate: 0, imported: 0, skipped: 0, errors: [] };
  const supabase = await createClient();
  const vkn = await ownVkn(supabase);
  const rows: EinvRow[] = [];
  const errors: string[] = [];
  let skipped = 0;
  for (const x of xmls.slice(0, 200)) {
    try { const r = rowFromXml(String(x.xml ?? ""), vkn, null); if (r) { if (!rows.some((y) => y.ettn === r.ettn)) rows.push(r); } else skipped++; }
    catch (e) { errors.push(`${String(x.name).slice(0, 80)}: ${(e as Error).message}`.slice(0, 160)); }
  }
  if (!rows.length) return { ok: true, message: "", added: 0, duplicate: 0, imported: 0, skipped, errors };
  const { data, error } = await supabase.rpc("einv_inbox_add", { p_rows: rows, p_source: "upload" });
  if (error) return { ok: false, message: msg(error.message), added: 0, duplicate: 0, imported: 0, skipped, errors };
  const d = data as { added: number; duplicate: number; already_imported: number };
  again();
  return { ok: true, message: "", added: d.added, duplicate: d.duplicate, imported: d.already_imported, skipped, errors };
}

/** e-İrsaliyeden mal kabul aç: tedarikçi (yoksa açılır), irsaliye no ve kalemler; okutma / eşleştirme mal kabul ekranında */
export async function einvToReceipt(f: FormData) {
  const ses = await getSession();
  if ((ses.modules.stock ?? 0) < 2) await fail("Mal kabul için stok (düzenleme) yetkisi gerekir.");
  const supabase = await createClient();
  const id = str(f, "id", 40);
  const { data: row } = await supabase.from("einv_inbox").select("xml, doc_no, ettn").eq("id", id).maybeSingle();
  if (!row) await fail("İrsaliye bulunamadı.");
  let d;
  try { d = parseDespatch(row!.xml as string); } catch (e) { return await fail((e as Error).message); }
  const p = d.supplier;
  const { data: partyId, error: pe } = await supabase.rpc("fin_party_ensure", { p: { name: p.name, tax_no: p.tax_no, tax_office: p.tax_office, address: p.address, district: p.district, city: p.city, country: p.country && /türkiye|turkey|^tr$/i.test(p.country) ? "TR" : p.country, email: p.email, phone: p.phone, website: p.website, is_einvoice: true, source: "einvoice" }, p_role: "supplier" });
  if (pe) await fail(`Tedarikçi açılamadı: ${pe.message}`);
  const { data: rid, error: re } = await supabase.rpc("stk_rcv_start", { p: { po_id: null, party_id: partyId, warehouse_id: null, supplier_doc: d.doc_no.slice(0, 60), note: `e-İrsaliye ${d.doc_no} · ETTN ${row!.ettn}`.slice(0, 500) } });
  if (re) await fail(`Mal kabul açılamadı: ${re.message}`);
  for (const l of d.lines.slice(0, 300)) {
    const { error } = await supabase.rpc("stk_rcv_free", { p_id: rid, p_name: l.seller_code ? `${l.name} (${l.seller_code})` : l.name, p_qty: l.qty, p_unit: l.unit });
    if (error) await fail(`Kalem eklenemedi (${l.name}): ${error.message}`);
  }
  revalidatePath("/stok/mal-kabul");
  again();
  redirect(`/stok/mal-kabul/${rid}?tamam=${encodeURIComponent("e-İrsaliye kalemleri mal kabule alındı; ürünleri okutup ya da karta bağlayıp onaylayın.")}`);
}

/** eLogo bağlantı testi (WSDL + oturum) */
export async function einvElogoTest() {
  await need();
  const { elogoTest } = await import("@/lib/elogo");
  let r;
  try { r = await elogoTest(); } catch (e) { return await fail(`eLogo: ${(e as Error).message}`.slice(0, 280)); }
  if (!r.ok) await fail(r.message.slice(0, 280));
  await done(r.message.slice(0, 280));
}

/** eLogo'dan şimdi çek: son 7 gün ya da "geçmiş" seçilirse başlangıç tarihinden bugüne */
export async function einvElogoSync(f: FormData) {
  await need();
  const supabase = await createClient();
  const { data: set } = await supabase.from("einv_settings").select("elogo_from").maybeSingle();
  const today = new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 10);
  const week = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  const from = f.get("all") === "1" && set?.elogo_from ? (set.elogo_from as string) : week;
  const { elogoSync } = await import("@/lib/elogo");
  let r;
  try { r = await elogoSync(supabase, { from, to: today, max: 60 }); } catch (e) { return await fail(`eLogo: ${(e as Error).message}`.slice(0, 280)); }
  again();
  if (!r.ok) await fail(r.message.slice(0, 280));
  await done(r.message);
}

export async function einvElogoSettings(f: FormData) {
  await need();
  const supabase = await createClient();
  const from = str(f, "from", 10);
  const { error } = await supabase.rpc("einv_elogo_settings", { p_enabled: f.get("enabled") === "on", p_from: /^\d{4}-\d{2}-\d{2}$/.test(from) ? from : null });
  if (error) await fail(msg(error.message));
  again();
  await done("eLogo eşitleme ayarı kaydedildi.");
}

/** PDF fatura yükle (e-Arşiv): yapay zekâyla okunup gelen kutusuna eklenir */
export async function einvUploadPdf(f: FormData) {
  await need();
  const files = f.getAll("pdfs").filter((x): x is File => x instanceof File && x.size > 0 && /\.pdf$/i.test(x.name)).slice(0, 5);
  if (!files.length) await fail("PDF dosyası seçin.");
  const { pdfReaderConfigured, readEinvPdf } = await import("@/lib/einv-pdf");
  if (!pdfReaderConfigured()) await fail("PDF okumak için Vercel'e ANTHROPIC_API_KEY eklenmeli.");
  const supabase = await createClient();
  let admin;
  try { admin = createAdminClient(); } catch { await fail("Sunucu anahtarı (SUPABASE_SERVICE_ROLE_KEY) ayarlı değil."); }
  const vkn = await ownVkn(supabase);
  const rows = [];
  const notes: string[] = [];
  for (const file of files) {
    const r = await readEinvPdf(admin!, Buffer.from(await file.arrayBuffer()), vkn, `upload:${file.name}`.slice(0, 200));
    if (r.row) rows.push(r.row); else notes.push(`${file.name}: ${r.reason}`);
  }
  let added = 0, dup = 0;
  if (rows.length) {
    const { data, error } = await supabase.rpc("einv_inbox_add", { p_rows: rows, p_source: "upload" });
    if (error) await fail(msg(error.message));
    added = Number((data as { added: number }).added ?? 0); dup = Number((data as { duplicate: number }).duplicate ?? 0);
  }
  again();
  if (!added && !dup) await fail(`Eklenecek fatura bulunamadı. ${notes.join(" · ")}`.slice(0, 300));
  await done(`${added} PDF fatura okunup eklendi${dup ? `, ${dup} tanesi zaten kutudaydı` : ""}. Aktarmadan önce okunan bilgileri kontrol edin.${notes.length ? ` Atlanan: ${notes.join(" · ")}` : ""}`.slice(0, 300));
}
