import "server-only";
import JSZip from "jszip";
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseDespatch, parseUbl, ublKind } from "@/lib/ubl";
import { accessToken, getAttachment, getThread, gmailConfigured, listThreads } from "@/lib/gmail";

export type EinvRow = {
  ettn: string; doc_kind: "efatura" | "earsiv" | "eirsaliye"; doc_no: string; issue_date: string | null; profile: string; type_code: string; sender_vkn: string | null; sender_name: string;
  currency: string; payable: number; vat_total: number; line_count: number; xml: string; source_ref: string | null;
};

export const DEFAULT_MAIL_QUERY = "has:attachment (filename:xml OR filename:zip) newer_than:14d";

/** XML'den gelen kutusu satırı (e-fatura, e-arşiv fatura, e-irsaliye); e-belge değilse ya da kendi kestiğimiz belgeyse null */
export function rowFromXml(xml: string, ownVkn: string | null, ref: string | null): EinvRow | null {
  const kind = ublKind(xml);
  if (!kind) return null;
  if (kind === "despatch") {
    const d = parseDespatch(xml);
    if (!d.ettn || !/^[0-9a-f-]{36}$/i.test(d.ettn)) return null;
    const vkn = (d.supplier.tax_no ?? "").replace(/\D/g, "") || null;
    if (ownVkn && vkn === ownVkn) return null;
    return {
      ettn: d.ettn.toLowerCase(), doc_kind: "eirsaliye", doc_no: d.doc_no, issue_date: /^\d{4}-\d{2}-\d{2}$/.test(d.date) ? d.date : null, profile: d.profile, type_code: d.type_code,
      sender_vkn: vkn, sender_name: d.supplier.name || "—", currency: "TRY", payable: 0, vat_total: 0, line_count: d.lines.length, xml, source_ref: ref,
    };
  }
  const inv = parseUbl(xml);
  if (!inv.ettn || !/^[0-9a-f-]{36}$/i.test(inv.ettn)) return null;
  const vkn = (inv.supplier.tax_no ?? "").replace(/\D/g, "") || null;
  if (ownVkn && vkn === ownVkn) return null; // giden (kendi) fatura
  return {
    ettn: inv.ettn.toLowerCase(), doc_kind: inv.profile.toUpperCase() === "EARSIVFATURA" ? "earsiv" : "efatura",
    doc_no: inv.doc_no, issue_date: /^\d{4}-\d{2}-\d{2}$/.test(inv.date) ? inv.date : null, profile: inv.profile, type_code: inv.type_code,
    sender_vkn: vkn, sender_name: inv.supplier.name || "—", currency: inv.currency, payable: inv.payable, vat_total: inv.vat_total, line_count: inv.lines.length, xml, source_ref: ref,
  };
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
  const errors: string[] = [];
  let next: string | null = null;
  let pages = 0;
  do {
    const r = await listThreads(token, { q: (set.mail_query as string) || DEFAULT_MAIL_QUERY, max: 25, ...(next ? { pageToken: next } : {}) });
    for (const t of r.rows) {
      const th = await getThread(token, t.id);
      for (const m of th.messages) {
        for (const a of m.attachments.filter((x) => /\.(xml|zip)$/i.test(x.name)).slice(0, 10)) {
          try {
            const buf = await getAttachment(token, m.id, a.id);
            for (const x of await xmlsFromFile(a.name, buf)) {
              try { const row = rowFromXml(x.xml, vkn, `gmail:${m.id}`); if (row && !rows.some((y) => y.ettn === row.ettn)) rows.push(row); } catch { /* e-fatura değil */ }
            }
          } catch (e) { errors.push(`${a.name}: ${(e as Error).message}`.slice(0, 120)); }
        }
      }
    }
    next = r.next;
    pages++;
  } while (next && pages < 4);
  let added = 0;
  for (let i = 0; i < rows.length; i += 25) {
    const { data, error } = await supabase.rpc("einv_inbox_add", { p_rows: rows.slice(i, i + 25), p_source: "email" });
    if (error) return { ok: false, message: error.message };
    added += Number((data as { added: number }).added ?? 0);
  }
  const result = { found: rows.length, added, errors: errors.slice(0, 5) };
  await supabase.rpc("einv_scan_log", { p_result: result });
  return { ok: true, message: `E-postada ${rows.length} e-fatura bulundu, ${added} tanesi yeni.${errors.length ? ` ${errors.length} ek okunamadı.` : ""}`, added, found: rows.length };
}
