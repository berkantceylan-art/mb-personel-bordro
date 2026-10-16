import "server-only";
import * as XLSX from "xlsx";
import type { SupabaseClient } from "@supabase/supabase-js";
import { accessToken, emailOf, getAttachment, getMessageAttachments, gmailConfigured, isQuotaError, listMessageIds } from "@/lib/gmail";
import { guessMapping, parseMt940, rowsFromTable, type BankRow } from "@/lib/bank-parse";

/** Banka ekstresi e-postası: varsayılan Gmail araması (son 10 gün, ekstre uzantılı ekler) */
export const BANK_MAIL_QUERY = "has:attachment newer_than:10d (filename:sta OR filename:940 OR filename:mt940 OR filename:txt OR filename:xlsx OR filename:xls OR filename:csv)";

export type Statement = { hint: string | null; rows: BankRow[] };
const EXT = /\.(sta|940|mt940|txt|xlsx|xls|csv|dat)$/i;

function decode(buf: Buffer): string {
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return buf.subarray(3).toString("utf8");
  try { return new TextDecoder("utf-8", { fatal: true }).decode(buf); } catch { return new TextDecoder("windows-1254").decode(buf); }
}

const clean = (rows: BankRow[]) => rows
  .filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.date) && Number.isFinite(r.amount) && r.amount !== 0)
  .map((r) => ({ date: r.date, description: String(r.description ?? "").slice(0, 500), amount: Math.round(r.amount), balance: r.balance == null || !Number.isFinite(r.balance) ? null : Math.round(r.balance), ref: r.ref ? String(r.ref).slice(0, 80) : null }));

/** Ekten ekstreler: MT940 (bir dosyada birden çok hesap olabilir) ya da Excel / CSV. Hesap ipucu: :25: alanı ya da tablodaki IBAN. */
export function parseStatements(name: string, buf: Buffer): Statement[] {
  const head = buf.subarray(0, 4000).toString("latin1");
  if (/:20:/.test(head) && /:61:|:25:/.test(buf.toString("latin1"))) {
    const text = decode(buf);
    return text.split(/(?=^:20:)/m).map((chunk) => {
      const m = chunk.match(/^:25:([^\r\n]+)/m);
      return { hint: m ? m[1]!.trim().slice(0, 120) : null, rows: clean(parseMt940(chunk)) };
    }).filter((s) => s.rows.length);
  }
  if (/\.(xlsx|xls|csv|txt)$/i.test(name)) {
    const wb = /\.(csv|txt)$/i.test(name) ? XLSX.read(decode(buf), { type: "string", raw: true }) : XLSX.read(buf, { type: "buffer", cellDates: true });
    const ws = wb.Sheets[wb.SheetNames[0]!];
    if (!ws) return [];
    const t = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: "" });
    const m = guessMapping(t);
    if (!m) return [];
    const top = t.slice(0, Math.max(15, m.header + 1)).flat().map((x) => String(x ?? "")).join(" ") + " " + name;
    const iban = top.replace(/\s+/g, "").match(/TR\d{24}/i)?.[0] ?? null;
    const acc = top.match(/hesap\s*(?:no|numarası)?\s*[:.]?\s*([\d\-/ ]{5,30})/i)?.[1]?.replace(/\D/g, "") ?? null;
    return [{ hint: iban ?? acc, rows: clean(rowsFromTable(t, m)) }].filter((s) => s.rows.length);
  }
  return [];
}

/**
 * Bağlı Gmail kutusunu tarar; ekstreleri ilgili banka hesabına aktarır.
 * admin: service role istemci (zamanlanmış görev ya da yetkisi denetlenmiş eylem).
 */
export async function scanBankMail(admin: SupabaseClient): Promise<{ ok: boolean; message: string; imported?: number; pending?: number }> {
  if (!gmailConfigured()) return { ok: false, message: "Gmail bağlantısı ayarlı değil." };
  const { data: set } = await admin.from("fin_bank_mail_settings").select("company_id, mail_account_id, query, enabled").limit(1).maybeSingle();
  if (!set?.mail_account_id) return { ok: false, message: "Taranacak e-posta hesabı seçilmemiş (Finans → Banka e-postası)." };
  if (!set.enabled) return { ok: false, message: "Otomatik tarama kapalı." };
  const { data: acc } = await admin.from("mail_accounts").select("id, user_id, email").eq("id", set.mail_account_id).maybeSingle();
  if (!acc) return { ok: false, message: "Seçilen e-posta hesabı bulunamadı." };
  const company = set.company_id as string;
  const log = async (message: string) => { await admin.from("fin_bank_mail_settings").update({ last_run_at: new Date().toISOString(), last_result: message.slice(0, 1000) }).eq("company_id", company); };

  let token: string;
  try { token = (await accessToken(acc.id as string, acc.user_id as string)).token; } catch (e) { const m = `Gmail'e bağlanılamadı: ${(e as Error).message}`; await log(m); return { ok: false, message: m }; }

  const ids: string[] = [];
  try {
    let next: string | null = null;
    do {
      const r = await listMessageIds(token, { q: (set.query as string) || BANK_MAIL_QUERY, max: 50, ...(next ? { pageToken: next } : {}) });
      ids.push(...r.ids); next = r.next;
    } while (next && ids.length < 100);
  } catch (e) { const m = isQuotaError(e) ? "Gmail kotası doldu, sonra tekrar denenecek." : `Gmail araması: ${(e as Error).message}`; await log(m); return { ok: false, message: m }; }

  const { data: seen } = ids.length ? await admin.from("fin_bank_mail_seen").select("ref").in("ref", ids.map((i) => `msg:${i}`)) : { data: [] };
  const done = new Set(((seen ?? []) as { ref: string }[]).map((x) => x.ref));
  const todo = ids.filter((i) => !done.has(`msg:${i}`)).slice(0, 25);
  let imported = 0, pending = 0, added = 0;
  const errors: string[] = [];

  for (const id of todo) {
    try {
      const m = await getMessageAttachments(token, id);
      const sender = emailOf(m.from || "");
      let any = false;
      for (const a of m.attachments.filter((x) => EXT.test(x.name)).slice(0, 8)) {
        const buf = await getAttachment(token, m.id, a.id);
        let sts: Statement[] = [];
        try { sts = parseStatements(a.name, buf); } catch (e) { errors.push(`${a.name}: ${(e as Error).message}`.slice(0, 120)); }
        for (const [i, st] of sts.entries()) {
          any = true;
          const ref = `msg:${id}:${a.name}:${i}`.slice(0, 300);
          const { data: accountId } = await admin.rpc("fin_bank_mail_resolve", { p_hint: st.hint, p_sender: sender });
          if (accountId) {
            const { data: r, error } = await admin.rpc("fin_bank_import_core", { p_account: accountId, p_file: `${a.name} (e-posta)`, p_rows: st.rows.slice(0, 3000) });
            if (error) { errors.push(`${a.name}: ${error.message}`.slice(0, 120)); continue; }
            const rr = r as { rows: number; added: number };
            imported++; added += rr.added;
            await admin.from("fin_bank_mail_seen").upsert({ ref, company_id: company, account_id: accountId, sender, subject: m.subject.slice(0, 200), file_name: a.name.slice(0, 200), rows: rr.rows, added: rr.added, result: "aktarıldı" });
          } else {
            pending++;
            await admin.from("fin_bank_mail_pending").upsert({ ref, company_id: company, sender, subject: m.subject.slice(0, 200), file_name: a.name.slice(0, 200), hint: st.hint, rows: st.rows.slice(0, 3000), row_count: st.rows.length, received_at: new Date().toISOString() }, { onConflict: "ref" });
          }
        }
      }
      await admin.from("fin_bank_mail_seen").upsert({ ref: `msg:${id}`, company_id: company, sender, subject: m.subject.slice(0, 200), result: any ? "işlendi" : "ekstre eki yok" });
    } catch (e) {
      if (isQuotaError(e)) { errors.push("Gmail kotası doldu"); break; }
      errors.push(`${id}: ${(e as Error).message}`.slice(0, 120));
    }
  }
  const message = `${todo.length} e-posta incelendi · ${imported} ekstre aktarıldı (${added} yeni hareket)${pending ? ` · ${pending} ekin hesabı seçilmeli` : ""}${errors.length ? ` · hata: ${errors.slice(0, 3).join(" | ")}` : ""}`;
  await log(message);
  return { ok: true, message, imported, pending };
}
