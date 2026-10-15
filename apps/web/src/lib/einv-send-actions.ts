"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import { done, fail } from "@/lib/flash";
import { DIRECTION, invError, type Direction } from "@/lib/invoice";
import { checkParties, refreshPending, sendInvoice } from "@/lib/einv-send";
import { elogoCancelEArchive, elogoConfigured, withElogo } from "@/lib/elogo";

const str = (f: FormData, k: string, max = 300) => String(f.get(k) ?? "").trim().slice(0, max);
const uuid = (v: string) => (/^[0-9a-f-]{36}$/i.test(v) ? v : "");

async function need(direction: Direction, lvl = 2) {
  const s = await getSession();
  if ((s.modules[DIRECTION[direction].module] ?? 0) < lvl) await fail(invError("not_allowed"));
}
function again(id: string, direction: Direction) {
  revalidatePath(`/fatura/${id}`);
  revalidatePath(DIRECTION[direction].base, "layout");
}
async function dirOf(id: string): Promise<Direction> {
  const supabase = await createClient();
  const { data } = await supabase.from("inv_invoices").select("direction").eq("id", id).maybeSingle();
  return data?.direction === "purchase" ? "purchase" : "sale";
}

/** eLogo'ya gönder (taslak ya da doğrudan) */
export async function einvSend(f: FormData) {
  const id = uuid(str(f, "id", 40));
  if (!id) await fail("Fatura seçin.");
  const direction = await dirOf(id);
  await need(direction);
  const supabase = await createClient();
  let r: Awaited<ReturnType<typeof sendInvoice>>;
  try { r = await sendInvoice(supabase, id, { draft: str(f, "mode", 10) !== "direct", alias: str(f, "alias", 200) || null }); }
  catch (e) { r = { ok: false, message: `eLogo: ${(e as Error).message}`.slice(0, 280) }; }
  again(id, direction);
  if (!r.ok) await fail(r.errors && r.errors.length > 1 ? `Gönderilmedi: ${r.errors.join(" • ")}`.slice(0, 300) : r.message);
  await done(r.message);
}

/** Gönderim durumunu eLogo'dan yenile */
export async function einvRefresh(f: FormData) {
  const id = uuid(str(f, "id", 40));
  const direction = await dirOf(id);
  await need(direction);
  const supabase = await createClient();
  let msg = "";
  try { const r = await refreshPending(supabase, [id]); msg = r.errors ? "Durum alınamadı; biraz sonra yeniden deneyin." : ""; } catch (e) { msg = `eLogo: ${(e as Error).message}`; }
  again(id, direction);
  if (msg) await fail(msg.slice(0, 280));
  await done("Durum güncellendi.");
}

/** e-Arşiv iptali (eLogo) + muhasebe kaydının geri alınması */
export async function einvCancelEArchive(f: FormData) {
  const id = uuid(str(f, "id", 40));
  const direction = await dirOf(id);
  await need(direction, 3);
  const reason = str(f, "reason", 300) || "e-Arşiv iptali";
  const supabase = await createClient();
  const { data: inv } = await supabase.from("inv_invoices").select("ettn, doc_no, profile, einvoice_status, invoice_date, status").eq("id", id).maybeSingle();
  if (!inv) await fail("Fatura bulunamadı.");
  if (inv!.profile !== "EARSIVFATURA") await fail("Yalnız e-Arşiv faturası iptal edilebilir. e-Fatura için alıcı reddetmeli ya da iade faturası kesilmeli.");
  if (!["sent", "accepted", "error", "draft_sent"].includes(inv!.einvoice_status as string)) await fail("Bu fatura eLogo'ya gönderilmemiş; doğrudan iptal edebilirsiniz.");
  let r = { ok: false, message: "" };
  try { r = await withElogo((w, s) => elogoCancelEArchive(w, s, inv!.ettn as string, (inv!.doc_no as string | null) ?? null)); } catch (e) { r = { ok: false, message: (e as Error).message }; }
  if (!r.ok) await fail(`eLogo iptali yapamadı: ${r.message}`.slice(0, 280));
  await supabase.rpc("inv_einv_update", { p_id: id, p: { status: "cancelled", desc: `İptal: ${reason}` } });
  const { error } = inv!.status === "posted" ? await supabase.rpc("inv_cancel", { p_id: id, p_reason: reason }) : { error: null };
  again(id, direction);
  if (error) await fail(`e-Arşiv eLogo'da iptal edildi ama muhasebe kaydı geri alınamadı: ${invError(error.message)}`);
  await done("e-Arşiv faturası iptal edildi; cari, KDV ve stok geri alındı.");
}

/** Carinin GİB mükellefiyetini sorgula */
export async function einvCheckParty(f: FormData) {
  const party = uuid(str(f, "party", 40));
  const s = await getSession();
  if ((s.modules.sales ?? 0) < 2 && (s.modules.purchases ?? 0) < 2) await fail(invError("not_allowed"));
  if (!elogoConfigured()) await fail("eLogo bağlantısı yok.");
  const supabase = await createClient();
  const { data: p } = await supabase.from("fin_parties").select("id, tax_no, country").eq("id", party).maybeSingle();
  if (!p?.tax_no) await fail("Carinin VKN / TCKN'si yok.");
  let m = "";
  try {
    const res = await checkParties(supabase, [p as { id: string; tax_no: string; country: string }]);
    const u = res.get(party);
    m = !u ? "Sorgulanamadı (yurt dışı ya da geçersiz VKN)." : u.einvoice ? `e-Fatura mükellefi${u.invoiceAliases.length > 1 ? ` (${u.invoiceAliases.length} posta kutusu)` : ""}${u.edespatch ? ", e-İrsaliye mükellefi" : ""}.` : "e-Fatura mükellefi değil: e-Arşiv kesilir.";
  } catch (e) { await fail(`GİB sorgusu yapılamadı: ${(e as Error).message}`.slice(0, 280)); }
  revalidatePath("/", "layout");
  await done(m);
}

/** Faturanın türe özel alanları (ihracat, kamu, internet satışı, satır kodları) */
export async function einvSaveEdoc(f: FormData) {
  const id = uuid(str(f, "id", 40));
  const direction = await dirOf(id);
  await need(direction);
  const supabase = await createClient();
  const keys = ["profile", "type_code", "send_method", "incoterm", "transport_mode", "package_kind", "package_no", "package_count", "delivery_address", "buyer_name", "buyer_tax_no", "pay_method", "pay_agent", "pay_date", "ship_date", "carrier_tax_no", "carrier_name", "export_doc_kind", "export_doc_no", "export_doc_date"];
  const p: Record<string, unknown> = {};
  for (const k of keys) if (f.has(k)) p[k] = str(f, k, 300);
  if (f.has("online_sale_on")) p.online_sale = f.get("online_sale") === "on";
  const { error } = await supabase.rpc("inv_set_edoc", { p_id: id, p });
  if (error) await fail(invError(error.message));
  for (const lid of f.getAll("line").map(String).filter((x) => uuid(x)).slice(0, 500)) {
    const lp: Record<string, unknown> = {};
    for (const k of ["gtip", "ident_scheme", "ident", "diib_line", "vat_exemption_code", "withholding_code"]) if (f.has(`${k}_${lid}`)) lp[k] = str(f, `${k}_${lid}`, 200);
    if (Object.keys(lp).length) { const { error: le } = await supabase.rpc("inv_set_line_edoc", { p_line: lid, p: lp }); if (le) await fail(invError(le.message)); }
  }
  const fid = str(f, "foreign_tax_id", 40);
  if (f.has("foreign_tax_id")) {
    const { data: inv } = await supabase.from("inv_invoices").select("party_id").eq("id", id).maybeSingle();
    if (inv?.party_id) await supabase.rpc("fin_party_gib_set", { p_party: inv.party_id, p: { foreign_tax_id: fid } });
  }
  again(id, direction);
  await done("e-Belge bilgileri kaydedildi.");
}

/** Şirket e-belge ayarları */
export async function einvCompanySettings(f: FormData) {
  const s = await getSession();
  if ((s.modules.sales ?? 0) < 3) await fail(invError("not_allowed"));
  const supabase = await createClient();
  const { error } = await supabase.rpc("einv_company_settings", { p: {
    numbering: str(f, "numbering", 10) || null, draft: f.get("draft") === "on",
    xslt_efatura: str(f, "xslt_efatura", 40), xslt_earsiv: str(f, "xslt_earsiv", 40), xslt_irsaliye: str(f, "xslt_irsaliye", 40),
    prefix_irsaliye: str(f, "prefix_irsaliye", 3), iban: str(f, "iban", 40), web: str(f, "web", 200),
  } });
  if (error) await fail(/check constraint/.test(error.message) ? "Değerlerden biri hatalı (IBAN TR ile başlayan 26 karakter, tasarım kodu UUID, önek 3 harf/rakam)." : invError(error.message));
  revalidatePath("/satis/ayarlar");
  await done("e-Belge ayarları kaydedildi.");
}
