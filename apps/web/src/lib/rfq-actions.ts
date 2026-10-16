"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { done, fail } from "@/lib/flash";
import { parseMoney } from "@/lib/jobs";
import { rfqError, rfqNo } from "@/lib/rfq";
import { accessToken, gmailConfigured, sendMail } from "@/lib/gmail";
import { erpUrl } from "@/lib/po-send";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const UUID = /^[0-9a-f-]{36}$/i;
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Yeni teklif isteği: satırlar (istekten ya da elle) + tedarikçiler */
export async function createRfq(f: FormData) {
  const names = f.getAll("l_name").map(String), qtys = f.getAll("l_qty").map(String), units = f.getAll("l_unit").map(String), items = f.getAll("l_item").map(String), reqs = f.getAll("l_req").map(String);
  const lines = names.map((n, i) => ({ name: n.trim(), qty: Number((qtys[i] ?? "").replace(",", ".")) || 0, unit: units[i] || "adet", item_id: UUID.test(items[i] ?? "") ? items[i] : null, request_line_id: UUID.test(reqs[i] ?? "") ? reqs[i] : null })).filter((l) => l.name && l.qty > 0);
  const parties = f.getAll("party").map(String).filter((x) => UUID.test(x));
  if (!lines.length) await fail("En az bir kalem girin.");
  if (!parties.length) await fail("En az bir tedarikçi seçin.");
  const sb = await createClient();
  const { data, error } = await sb.rpc("pur_rfq_create", { p: { title: str(f, "title"), due_date: str(f, "due_date") || null, note: str(f, "note"), currency: str(f, "currency") || "TRY", lines, parties } });
  if (error) await fail(rfqError(error.message));
  revalidatePath("/satinalma", "layout");
  redirect(`/satinalma/teklifler/${data as string}?tamam=${encodeURIComponent("Teklif isteği oluşturuldu. Tedarikçilere bağlantıyı gönderin.")}`);
}

export async function addRfqSupplier(f: FormData) {
  const sb = await createClient();
  const { error } = await sb.rpc("pur_rfq_add_supplier", { p_rfq: str(f, "rfq"), p_party: str(f, "party") });
  if (error) await fail(rfqError(error.message));
  revalidatePath(`/satinalma/teklifler/${str(f, "rfq")}`);
  await done("Tedarikçi eklendi.");
}

/** Satın alma, telefonla / e-postayla gelen teklifi kendisi girer */
export async function quoteInternal(f: FormData) {
  const row = str(f, "row"), rfq = str(f, "rfq");
  const lineIds = f.getAll("line").map(String);
  const quotes = lineIds.map((id) => {
    const price = parseMoney(str(f, `p_${id}`));
    return { line_id: id, unit_price: price, vat_rate: str(f, `v_${id}`) || "20", available: price != null && f.get(`na_${id}`) !== "on" };
  });
  const sb = await createClient();
  const { error } = await sb.rpc("pur_rfq_quote_internal", { p_row: row, p: { delivery_days: str(f, "delivery_days") || null, valid_until: str(f, "valid_until") || null, note: str(f, "note"), name: str(f, "name"), decline: f.get("decline") === "on", quotes } });
  if (error) await fail(rfqError(error.message));
  revalidatePath(`/satinalma/teklifler/${rfq}`);
  await done("Teklif kaydedildi.");
}

/** Kazanan teklif → taslak satın alma siparişi */
export async function awardRfq(f: FormData) {
  const sb = await createClient();
  const { data, error } = await sb.rpc("pur_rfq_award", { p_rfq: str(f, "rfq"), p_row: str(f, "row") });
  if (error) await fail(rfqError(error.message));
  revalidatePath("/satinalma", "layout");
  redirect(`/alis/siparisler/${data as string}?tamam=${encodeURIComponent("Kazanan teklif siparişe dönüştü. Kontrol edip onaya gönderin.")}`);
}

export async function cancelRfq(f: FormData) {
  const sb = await createClient();
  const { error } = await sb.rpc("pur_rfq_cancel", { p_rfq: str(f, "rfq") });
  if (error) await fail(rfqError(error.message));
  revalidatePath("/satinalma", "layout");
  await done("Teklif isteği iptal edildi.");
}

/** WhatsApp / elle gönderim işareti */
export async function markRfqSent(rows: string[]): Promise<void> {
  const sb = await createClient();
  await sb.rpc("pur_rfq_mark_sent", { p_rows: rows.filter((x) => UUID.test(x)) });
  revalidatePath("/satinalma/teklifler", "layout");
}

/** Teklif bağlantısını tedarikçilere e-postayla gönder (kullanıcının bağlı Gmail hesabından) */
export async function emailRfq(rfqId: string, rows: string[]): Promise<{ ok: boolean; message: string }> {
  const s = await getSession();
  if ((s.modules.purchases ?? 0) < 2 && (s.modules.stock ?? 0) < 2) return { ok: false, message: "Yetkiniz yok." };
  if (!gmailConfigured()) return { ok: false, message: "E-posta gönderimi kurulu değil." };
  const admin = createAdminClient();
  const { data: accs } = await admin.from("mail_accounts").select("id, user_id, display_name").eq("company_id", s.companyId).eq("status", "active").order("created_at");
  const acc = (accs ?? []).find((a) => a.user_id === s.userId) ?? (accs ?? [])[0];
  if (!acc) return { ok: false, message: "Bağlı e-posta hesabı yok (E-posta modülünden Gmail bağlayın)." };
  let token: string, from: string;
  try { ({ token, email: from } = await accessToken(acc.id as string, acc.user_id as string)); } catch (e) { return { ok: false, message: (e as Error).message }; }
  const sb = await createClient();
  const { data: r } = await sb.from("pur_rfqs").select("id, year, no, title, due_date, note").eq("id", rfqId).maybeSingle();
  if (!r) return { ok: false, message: "Teklif isteği bulunamadı." };
  const [{ data: sup }, { data: lines }] = await Promise.all([
    sb.from("pur_rfq_suppliers").select("id, token, fin_parties(name, email, order_email, contact_name)").eq("rfq_id", rfqId).in("id", rows.filter((x) => UUID.test(x))),
    sb.from("pur_rfq_lines").select("name, qty, unit").eq("rfq_id", rfqId).order("sort"),
  ]);
  const company = s.companyName || "MB Dental";
  const list = (lines ?? []).map((l) => `<li>${esc(l.name as string)} — ${Number(l.qty)} ${esc(l.unit as string)}</li>`).join("");
  let ok = 0; const errs: string[] = []; const sent: string[] = [];
  for (const x of (sup ?? []) as unknown as { id: string; token: string; fin_parties: { name: string; email: string | null; order_email: string | null; contact_name: string | null } | null }[]) {
    const to = (x.fin_parties?.order_email || x.fin_parties?.email || "").trim();
    if (!to) { errs.push(`${x.fin_parties?.name}: e-posta yok`); continue; }
    const link = `${erpUrl()}/tedarikci/teklif/${x.token}`;
    const html = `<div style="font-family:Arial,sans-serif;color:#1d2733;max-width:640px"><p>Sayın ${esc(x.fin_parties?.contact_name || x.fin_parties?.name || "Yetkili")},</p>
<p>${esc(company)} olarak aşağıdaki kalemler için fiyat teklifinizi rica ederiz.${r.due_date ? ` Son teklif tarihi: <b>${String(r.due_date).split("-").reverse().join(".")}</b>.` : ""}</p>
<p style="font-size:17px;font-weight:bold">${esc(r.title as string)} · ${rfqNo(r as { year: number; no: number })}</p><ul>${list}</ul>${r.note ? `<p>${esc(r.note as string)}</p>` : ""}
<p style="margin:22px 0"><a href="${link}" style="background:#0A3D73;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:bold">Teklif ver</a></p>
<p style="font-size:13px;color:#5b6b7c">Bağlantıdan birim fiyat, teslim süresi ve geçerlilik tarihini girebilirsiniz; üyelik gerekmez.</p><p>Saygılarımızla,<br>${esc(company)}</p></div>`;
    try {
      await sendMail(token, { from, fromName: (acc.display_name as string) || company, to, subject: `${company} fiyat teklifi isteği ${rfqNo(r as { year: number; no: number })}`, html, text: `${company} fiyat teklifi isteği: ${r.title}. Teklif vermek için: ${link}` });
      ok++; sent.push(x.id);
    } catch (e) { errs.push(`${x.fin_parties?.name}: ${(e as Error).message}`.slice(0, 160)); }
  }
  if (sent.length) await sb.rpc("pur_rfq_mark_sent", { p_rows: sent });
  revalidatePath(`/satinalma/teklifler/${rfqId}`);
  return { ok: ok > 0, message: `${ok} tedarikçiye e-posta gitti.${errs.length ? ` Gönderilemeyen: ${errs.join("; ")}` : ""}` };
}
