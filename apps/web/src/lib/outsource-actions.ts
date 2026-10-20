"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { accessToken, getAttachment, getMessageAttachments, gmailConfigured, isQuotaError, listMessageIds } from "@/lib/gmail";
import { osNorm, parseOutsourceStatement, type OsStatement } from "@/lib/outsource-parse";

type Res = { ok: boolean; message: string; batch?: string | null; job?: number; jobId?: string; patient?: string | null; customer?: string | null; problem?: boolean };
const SQL = "Önce mbdental-ortodonti.sql dosyasını Supabase'de çalıştırın.";
const missing = (m: string) => (/outsource|schema cache|does not exist/i.test(m) ? SQL : m);

async function guard() {
  const s = await getSession();
  if (!s.logistics) throw new Error("Laboratuvar modülü için yetkiniz yok.");
  return s;
}
const done = () => { revalidatePath("/isler/ortodonti"); };

/** Seçili işleri dış laboratuvara gönder (günlük liste oluşur) */
export async function outsourceSend(jobIds: string[], partyId: string, note: string): Promise<Res> {
  try {
    await guard();
    if (!jobIds.length) return { ok: false, message: "İş seçin." };
    if (!partyId) return { ok: false, message: "Dış laboratuvar seçin." };
    const sb = await createClient();
    const { data, error } = await sb.rpc("outsource_send", { p_jobs: jobIds, p_party: partyId, p_note: note || null });
    if (error) return { ok: false, message: missing(error.message) };
    const r = data as { batch: string | null; no: number | null; jobs: number };
    done();
    return r.batch ? { ok: true, message: `${r.jobs} iş gönderildi · liste #${r.no}`, batch: r.batch } : { ok: false, message: "Seçilen işler zaten gönderilmiş." };
  } catch (e) { return { ok: false, message: e instanceof Error ? e.message : String(e) }; }
}

/** İş geldi (iş no / barkod) */
export async function outsourceReceive(code: string, problem: boolean, note: string): Promise<Res> {
  try {
    await guard();
    if (!code.trim()) return { ok: false, message: "İş numarası okutun." };
    const sb = await createClient();
    const { data, error } = await sb.rpc("outsource_receive", { p_code: code.trim(), p_problem: problem, p_note: note || null });
    if (error) return { ok: false, message: missing(error.message) };
    const r = data as { ok: boolean; message: string; job?: number; job_id?: string; patient?: string | null; customer?: string | null; problem?: boolean };
    if (r.ok) done();
    return { ok: r.ok, message: r.message, job: r.job, jobId: r.job_id, patient: r.patient, customer: r.customer, problem: r.problem };
  } catch (e) { return { ok: false, message: e instanceof Error ? e.message : String(e) }; }
}

export async function outsourceUndo(id: string): Promise<Res> {
  try {
    await guard();
    const sb = await createClient();
    const { error } = await sb.rpc("outsource_undo", { p_id: id });
    if (error) return { ok: false, message: missing(error.message) };
    done();
    return { ok: true, message: "Geri alındı; iş yeniden dışarıda görünüyor." };
  } catch (e) { return { ok: false, message: e instanceof Error ? e.message : String(e) }; }
}

/** Bir cariyi dış laboratuvar olarak işaretle / kaldır */
export async function setOutsourceLab(partyId: string, on: boolean): Promise<Res> {
  try {
    await guard();
    const sb = await createClient();
    const { error } = await sb.from("fin_parties").update({ outsource_lab: on }).eq("id", partyId);
    if (error) return { ok: false, message: missing(error.message) };
    done();
    return { ok: true, message: on ? "Dış laboratuvar eklendi." : "Kaldırıldı." };
  } catch (e) { return { ok: false, message: e instanceof Error ? e.message : String(e) }; }
}

/** İş numaralarından id */
export async function jobIdsByNo(nos: string[]): Promise<string[]> {
  await guard();
  const n = nos.map((x) => Number(x.replace(/\D/g, ""))).filter((x) => x > 0).slice(0, 200);
  if (!n.length) return [];
  const sb = await createClient();
  const { data } = await sb.from("jobs").select("id").in("no", n);
  return ((data ?? []) as { id: string }[]).map((d) => d.id);
}

// ---------------------------------------------------------------- ekstre / fiyat listesi

type Res2 = { ok: boolean; message: string; lines?: string[] };
const SQL2 = "Önce mbdental-ortodonti-ekstre.sql dosyasını Supabase'de çalıştırın.";
const miss2 = (m: string) => (/outsource_(prices|lines|statement|price_alias)|schema cache|does not exist/i.test(m) ? SQL2 : m);
const tl = (k: number) => (k / 100).toLocaleString("tr-TR", { minimumFractionDigits: 2 });

async function saveStatement(party: string, st: OsStatement, file: string, mailRef?: string) {
  const sb = await createClient();
  const { data, error } = await sb.rpc("outsource_statement_save", { p_party: party, p: { ...st, file_name: file, mail_ref: mailRef ?? null } });
  if (error) throw new Error(miss2(error.message));
  return data as { statement: string | null; lines: number; skipped: number; already?: boolean };
}
const stLabel = (file: string, st: OsStatement, r: { lines: number; skipped: number; already?: boolean }) =>
  r.already ? `${file}: daha önce alınmış` : `${file}: ${st.lines.length} satır, ${tl(st.total)} ₺ · ${r.lines} yeni${r.skipped ? `, ${r.skipped} zaten kayıtlı` : ""}`;

/** Ekstre PDF yükle */
export async function uploadOutsourceStatements(f: FormData): Promise<Res2> {
  try {
    await guard();
    const party = String(f.get("party") ?? "");
    if (!party) return { ok: false, message: "Laboratuvar seçin." };
    const files = f.getAll("files").filter((x): x is File => x instanceof File && x.size > 0);
    if (!files.length) return { ok: false, message: "PDF seçin." };
    const lines: string[] = [];
    for (const file of files.slice(0, 20)) {
      try {
        const st = await parseOutsourceStatement(new Uint8Array(await file.arrayBuffer()));
        lines.push(`✓ ${stLabel(file.name, st, await saveStatement(party, st, file.name))}`);
      } catch (e) { lines.push(`✗ ${file.name}: ${(e as Error).message}`); }
    }
    revalidatePath("/isler/ortodonti/ekstre");
    return { ok: lines.some((l) => l.startsWith("✓")), message: "Ekstre okundu.", lines };
  } catch (e) { return { ok: false, message: (e as Error).message }; }
}

/** muhasebe@ (bağlı Gmail) → laboratuvarın e-posta adresinden gelen PDF ekstreler (01.01.2026'dan bu yana) */
export async function fetchOutsourceMail(party: string): Promise<Res2> {
  try {
    await guard();
    if (!gmailConfigured()) return { ok: false, message: "Gmail bağlantısı ayarlı değil." };
    const sb = await createClient();
    const { data: lab } = await sb.from("fin_parties").select("email").eq("id", party).maybeSingle();
    const email = (lab?.email as string | null)?.trim();
    if (!email) return { ok: false, message: "Laboratuvarın e-posta adresi yok. Bir ekstreyi elle yükleyin (adres PDF'ten alınır) ya da cari kartına yazın." };
    const admin = createAdminClient();
    const { data: set } = await sb.from("fin_bank_mail_settings").select("mail_account_id").limit(1).maybeSingle();
    if (!set?.mail_account_id) return { ok: false, message: "Taranacak e-posta hesabı seçilmemiş (Finans › Banka e-postası ayarından seçilir)." };
    const { data: acc } = await admin.from("mail_accounts").select("id, user_id").eq("id", set.mail_account_id).maybeSingle();
    if (!acc) return { ok: false, message: "E-posta hesabı bulunamadı." };
    const token = (await accessToken(acc.id as string, acc.user_id as string)).token;
    const { ids } = await listMessageIds(token, { q: `from:${email} has:attachment after:2026/01/01`, max: 50 });
    const { data: seen } = await sb.from("outsource_statements").select("mail_ref").not("mail_ref", "is", null);
    const done = new Set(((seen ?? []) as { mail_ref: string }[]).map((x) => x.mail_ref.split(":")[0]));
    const todo = ids.filter((i) => !done.has(i)).slice(0, 20);
    const lines: string[] = [];
    for (const id of todo) {
      try {
        const m = await getMessageAttachments(token, id);
        for (const a of m.attachments.filter((x) => /\.pdf$/i.test(x.name)).slice(0, 5)) {
          try {
            const st = await parseOutsourceStatement(new Uint8Array(await getAttachment(token, m.id, a.id)));
            lines.push(`✓ ${stLabel(a.name, st, await saveStatement(party, st, a.name, `${id}:${a.name}`.slice(0, 300)))}`);
          } catch (e) { lines.push(`– ${a.name}: ${(e as Error).message}`.slice(0, 160)); }
        }
      } catch (e) {
        if (isQuotaError(e)) { lines.push("Gmail kotası doldu; biraz sonra tekrar deneyin."); break; }
        lines.push(`✗ ${(e as Error).message}`.slice(0, 160));
      }
    }
    revalidatePath("/isler/ortodonti/ekstre");
    return { ok: true, message: `${email} adresinden ${todo.length} yeni e-posta incelendi.`, lines };
  } catch (e) { return { ok: false, message: miss2((e as Error).message) }; }
}

/** Fiyat listesi: her satır "AD; FİYAT" */
export async function saveOutsourcePrices(party: string, text: string): Promise<Res2> {
  try {
    await guard();
    const rows = text.split(/\n/).map((l) => l.trim()).filter(Boolean).map((l) => {
      const m = l.match(/^(.*?)[;\t|]\s*([\d.]+(?:,\d{1,2})?)\s*(TL)?$/i) ?? l.match(/^(.*?)\s+([\d.]+(?:,\d{1,2})?)\s*TL$/i);
      return m ? { name: m[1]!.trim(), price: Math.round(Number(m[2]!.replace(/\./g, "").replace(",", ".")) * 100) } : null;
    });
    const bad = rows.filter((r) => !r || !r.name).length;
    const ok = rows.filter((r): r is { name: string; price: number } => !!r && !!r.name);
    if (!ok.length) return { ok: false, message: "Satır okunamadı. Her satıra \"ÜRÜN ADI; 500\" biçiminde yazın." };
    const sb = await createClient();
    const { error } = await sb.rpc("outsource_prices_save", { p_party: party, p: ok });
    if (error) return { ok: false, message: miss2(error.message) };
    revalidatePath("/isler/ortodonti/ekstre");
    return { ok: true, message: `${ok.length} fiyat kaydedildi${bad ? ` (${bad} satır okunamadı)` : ""}.` };
  } catch (e) { return { ok: false, message: (e as Error).message }; }
}

/** Ekstredeki ürün adını fiyat listesi kalemine bağla (öğrenilir) */
export async function setOutsourceAlias(party: string, product: string, priceId: string): Promise<Res2> {
  try {
    await guard();
    const sb = await createClient();
    const norm = osNorm(product);
    const { error } = priceId
      ? await sb.from("outsource_price_alias").upsert({ party_id: party, norm_name: norm, price_id: priceId }, { onConflict: "company_id,party_id,norm_name" })
      : await sb.from("outsource_price_alias").delete().eq("party_id", party).eq("norm_name", norm);
    if (error) return { ok: false, message: miss2(error.message) };
    revalidatePath("/isler/ortodonti/ekstre");
    return { ok: true, message: "Eşleşme kaydedildi." };
  } catch (e) { return { ok: false, message: (e as Error).message }; }
}

export async function toggleOutsourceDispute(id: string, on: boolean, note: string): Promise<Res2> {
  try {
    await guard();
    const sb = await createClient();
    const { error } = await sb.from("outsource_lines").update({ disputed: on, note: note.slice(0, 500) || null }).eq("id", id);
    if (error) return { ok: false, message: miss2(error.message) };
    revalidatePath("/isler/ortodonti/ekstre");
    return { ok: true, message: on ? "İtiraz işaretlendi." : "İtiraz kaldırıldı." };
  } catch (e) { return { ok: false, message: (e as Error).message }; }
}

export async function relinkOutsourceLines(party: string): Promise<Res2> {
  try {
    await guard();
    const { data, error } = await (await createClient()).rpc("outsource_lines_relink", { p_party: party });
    if (error) return { ok: false, message: miss2(error.message) };
    revalidatePath("/isler/ortodonti/ekstre");
    return { ok: true, message: `${Number(data ?? 0)} satır yeniden eşleştirildi.` };
  } catch (e) { return { ok: false, message: (e as Error).message }; }
}
