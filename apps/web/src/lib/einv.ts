import "server-only";
import JSZip from "jszip";
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseDespatch, parseUbl, ublKind } from "@/lib/ubl";
import { accessToken, getAttachment, getMessageAttachments, gmailConfigured, isQuotaError, listMessageIds } from "@/lib/gmail";
import { pdfReaderConfigured, readEinvPdf, type PdfRow } from "@/lib/einv-pdf";

export type EinvRow = {
  ettn: string; doc_kind: "efatura" | "earsiv" | "eirsaliye"; direction?: "in" | "out"; doc_no: string; issue_date: string | null; profile: string; type_code: string; sender_vkn: string | null; sender_name: string;
  currency: string; payable: number; vat_total: number; line_count: number; xml: string; source_ref: string | null;
};

const OLD_MAIL_QUERY = "has:attachment (filename:xml OR filename:zip) newer_than:14d";
export const DEFAULT_MAIL_QUERY = "has:attachment newer_than:14d (filename:xml OR filename:zip OR (filename:pdf (fatura OR arşiv OR arsiv OR e-arşiv OR earsiv OR invoice)))";

/** XML'den kutu satırı; yön satıcı VKN'sinden (kendi VKN'miz → giden). e-belge değilse null */
export function rowFromXmlDir(xml: string, ownVkn: string | null, ref: string | null): EinvRow | null {
  const kind = ublKind(xml);
  if (!kind) return null;
  const d = kind === "despatch" ? parseDespatch(xml) : null;
  const inv = kind === "invoice" ? parseUbl(xml) : null;
  const ettn = (d?.ettn ?? inv?.ettn) || "";
  if (!/^[0-9a-f-]{36}$/i.test(ettn)) return null;
  const sup = (d?.supplier ?? inv!.supplier);
  const cus = (d?.customer ?? inv!.customer);
  const supVkn = (sup.tax_no ?? "").replace(/\D/g, "") || null;
  const out = !!ownVkn && supVkn === ownVkn;
  const other = out ? cus : sup;
  const date = d?.date ?? inv!.date;
  return {
    ettn: ettn.toLowerCase(), direction: out ? "out" : "in",
    doc_kind: d ? "eirsaliye" : inv!.profile.toUpperCase() === "EARSIVFATURA" ? "earsiv" : "efatura",
    doc_no: d?.doc_no ?? inv!.doc_no, issue_date: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null, profile: d?.profile ?? inv!.profile, type_code: d?.type_code ?? inv!.type_code,
    sender_vkn: (other.tax_no ?? "").replace(/\D/g, "") || null, sender_name: other.name || "—", currency: inv?.currency ?? "TRY", payable: inv?.payable ?? 0, vat_total: inv?.vat_total ?? 0,
    line_count: (d?.lines ?? inv!.lines).length, xml, source_ref: ref,
  };
}

/** Yalnız gelen belge (yükleme / e-posta): kendi kestiğimiz belgeyse null */
export function rowFromXml(xml: string, ownVkn: string | null, ref: string | null): EinvRow | null {
  const r = rowFromXmlDir(xml, ownVkn, ref);
  return r && r.direction === "in" ? r : null;
}

/** Dosyalardan (XML / ZIP) XML metinleri */
export async function xmlsFromFile(name: string, buf: Buffer): Promise<Array<{ name: string; xml: string }>> {
  if (/\.zip$/i.test(name)) {
    const zip = await JSZip.loadAsync(buf);
    const out: Array<{ name: string; xml: string }> = [];
    for (const e of Object.values(zip.files)) {
      if (e.dir) continue;
      if (/\.xml$/i.test(e.name)) out.push({ name: `${name} › ${e.name}`, xml: await e.async("string") });
      else if (/\.zip$/i.test(e.name)) out.push(...(await xmlsFromFile(e.name, await e.async("nodebuffer"))));
    }
    return out;
  }
  if (/\.xml$/i.test(name)) return [{ name, xml: buf.toString("utf8") }];
  return [];
}

export async function ownVkn(supabase: SupabaseClient): Promise<string | null> {
  const { data } = await supabase.from("companies").select("tax_no").order("created_at").limit(1).maybeSingle();
  return ((data?.tax_no as string | null) ?? "").replace(/\D/g, "") || null;
}

/** Bağlı Gmail hesabında e-fatura eklerini arar ve gelen kutusuna ekler */
export async function scanMailbox(supabase: SupabaseClient, admin: SupabaseClient): Promise<{ ok: boolean; message: string; added?: number; found?: number }> {
  if (!gmailConfigured()) return { ok: false, message: "Gmail bağlantısı ayarlı değil." };
  const { data: set } = await supabase.from("einv_settings").select("mail_account_id, mail_query").maybeSingle();
  if (!set?.mail_account_id) return { ok: false, message: "Taranacak e-posta hesabı seçilmemiş." };
  const { data: acc } = await admin.from("mail_accounts").select("id, user_id").eq("id", set.mail_account_id).maybeSingle();
  if (!acc) return { ok: false, message: "Seçilen e-posta hesabı bulunamadı." };
  const { token } = await accessToken(acc.id as string, acc.user_id as string);
  const vkn = await ownVkn(supabase);
  const rows: EinvRow[] = [];
  const pdfRows: PdfRow[] = [];
  const errors: string[] = [];
  const seenMarks: Array<{ ref: string; result: string }> = [];
  let pdfRead = 0;
  const PDF_MAX = 15;
  const q = !set.mail_query || set.mail_query === OLD_MAIL_QUERY ? DEFAULT_MAIL_QUERY : (set.mail_query as string);
  // 1) sorguya uyan e-posta kimlikleri (en çok 150), 2) daha önce işlenenler atlanır, 3) yeniler sırayla işlenir
  const ids: string[] = [];
  let next: string | null = null;
  let stopped = "";
  try {
    do {
      const r = await listMessageIds(token, { q, max: 50, ...(next ? { pageToken: next } : {}) });
      ids.push(...r.ids);
      next = r.next;
    } while (next && ids.length < 150);
  } catch (e) { if (isQuotaError(e)) stopped = "Gmail kotası doldu"; else throw e; }
  const msgRefs = ids.map((id) => `msg:${id}`);
  const seenMsgs = new Set<string>();
  for (let i = 0; i < msgRefs.length; i += 100) {
    const { data } = await supabase.rpc("einv_mail_seen_check", { p_refs: msgRefs.slice(i, i + 100) });
    ((data ?? []) as string[]).forEach((x) => seenMsgs.add(x));
  }
  const todo = ids.filter((id) => !seenMsgs.has(`msg:${id}`));
  const MSG_MAX = 40;
  let processed = 0;
  for (const id of todo.slice(0, MSG_MAX)) {
    if (stopped) break;
    try {
      const m = await getMessageAttachments(token, id);
      let gotXml = false;
      for (const a of m.attachments.filter((x) => /\.(xml|zip)$/i.test(x.name)).slice(0, 10)) {
        const buf = await getAttachment(token, m.id, a.id);
        try {
          for (const x of await xmlsFromFile(a.name, buf)) {
            try { const row = rowFromXml(x.xml, vkn, `gmail:${m.id}`); if (row) { gotXml = true; if (!rows.some((y) => y.ettn === row.ettn)) rows.push(row); } } catch { /* e-fatura değil */ }
          }
        } catch (e) { errors.push(`${a.name}: ${(e as Error).message}`.slice(0, 120)); }
      }
      // XML'i olmayan e-postadaki PDF fatura (çoğu e-Arşiv): yapay zekâyla okunur
      if (!gotXml && pdfReaderConfigured()) {
        const pdfs = m.attachments.filter((x) => /\.pdf$/i.test(x.name)).slice(0, 3);
        const { data: seenPdf } = pdfs.length ? await supabase.rpc("einv_mail_seen_check", { p_refs: pdfs.map((a) => `gmail:${m.id}:${a.name}`.slice(0, 300)) }) : { data: [] };
        let left = false;
        for (const a of pdfs) {
          if (((seenPdf ?? []) as string[]).includes(`gmail:${m.id}:${a.name}`.slice(0, 300))) continue;
          if (pdfRead >= PDF_MAX) { left = true; break; }
          pdfRead++;
          const res = await readEinvPdf(admin, await getAttachment(token, m.id, a.id), vkn, `gmail:${m.id}:${a.name}`.slice(0, 300));
          if (res.row && !rows.some((y) => y.ettn === res.row!.ettn) && !pdfRows.some((y) => y.ettn === res.row!.ettn)) pdfRows.push(res.row);
          seenMarks.push({ ref: `gmail:${m.id}:${a.name}`.slice(0, 300), result: res.row ? `okundu ${res.row.doc_no}` : res.reason ?? "" });
        }
        if (left) { stopped = stopped || "PDF sınırı"; continue; }
      }
      seenMarks.push({ ref: `msg:${id}`, result: gotXml ? "xml" : "işlendi" });
      processed++;
    } catch (e) {
      if (isQuotaError(e)) { stopped = "Gmail kotası doldu"; break; }
      errors.push(`${id}: ${(e as Error).message}`.slice(0, 120));
      seenMarks.push({ ref: `msg:${id}`, result: "hata" });
    }
  }
  const remaining = todo.length - processed;
  let added = 0;
  for (let i = 0; i < rows.length; i += 25) {
    const { data, error } = await supabase.rpc("einv_inbox_add", { p_rows: rows.slice(i, i + 25), p_source: "email" });
    if (error) return { ok: false, message: error.message };
    added += Number((data as { added: number }).added ?? 0);
  }
  let pdfAdded = 0;
  if (pdfRows.length) {
    const { data, error } = await supabase.rpc("einv_inbox_add", { p_rows: pdfRows, p_source: "email" });
    if (error) errors.push(`PDF kaydı: ${error.message}`.slice(0, 120));
    else pdfAdded = Number((data as { added: number }).added ?? 0);
  }
  if (seenMarks.length) await supabase.rpc("einv_mail_seen_mark", { p_rows: seenMarks });
  const result = { found: rows.length, added, pdf_read: pdfRead, pdf_added: pdfAdded, scanned: processed, remaining, stopped: stopped || null, errors: errors.slice(0, 5) };
  try { await supabase.rpc("einv_inbox_link_existing"); } catch { /* migration yoksa geç */ }
  await supabase.rpc("einv_scan_log", { p_result: result });
  return { ok: true, message: `E-postada ${rows.length} XML e-belge bulundu, ${added} tanesi yeni.${pdfRead ? ` ${pdfRead} PDF okundu, ${pdfAdded} e-Arşiv fatura eklendi.` : ""}${errors.length ? ` ${errors.length} ek okunamadı.` : ""}${remaining > 0 ? ` ${remaining} e-posta sırada (${stopped || "tarama sınırı"}); bir sonraki taramada devam eder.` : ""}`, added: added + pdfAdded, found: rows.length + pdfRows.length };
}
