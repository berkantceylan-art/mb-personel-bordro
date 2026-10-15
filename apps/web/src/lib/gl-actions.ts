"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import { done, fail } from "@/lib/flash";
import { parseAmount } from "@/lib/fin";
import { glError } from "@/lib/gl";

const str = (f: FormData, k: string, max = 300) => String(f.get(k) ?? "").trim().slice(0, max);

async function need(level: number) {
  const s = await getSession();
  if ((s.modules.ledger ?? 0) < level) await fail("Bu işlem için genel muhasebe yetkiniz yok.");
  return s;
}
const again = () => revalidatePath("/muhasebe", "layout");

export async function glSaveSettings(f: FormData) {
  await need(3);
  const supabase = await createClient();
  const codes = str(f, "exclude_codes", 500).split(/[,\s]+/).map((x) => x.trim()).filter((x) => /^[a-z0-9_]{2,40}$/.test(x));
  const { error } = await supabase.rpc("gl_settings_save", { p: { enabled: f.get("enabled") === "on", start_date: str(f, "start_date", 10) || null, export_format: str(f, "export_format", 20) || null, exclude_codes: codes, exclude_cash_salary: f.get("exclude_cash_salary") === "on", babs_limit: parseAmount(str(f, "babs_limit", 20)) } });
  if (error) await fail(glError(error.message));
  again();
  await done("Muhasebe ayarları kaydedildi.");
}

export async function glBackfill(f: FormData) {
  await need(3);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("gl_backfill", { p_from: str(f, "from", 10) || null, p_to: str(f, "to", 10) || null });
  if (error) await fail(glError(error.message));
  const d = data as { processed: number; posted: number; pending: number };
  again();
  await done(`${d.processed} ERP kaydı işlendi. Kayıtlı fiş: ${d.posted}, eşleştirme bekleyen: ${d.pending}.`);
}

export async function glRepost() {
  await need(2);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("gl_repost_pending");
  if (error) await fail(glError(error.message));
  again();
  await done(`${data ?? 0} bekleyen kayıt yeniden denendi.`);
}

export async function glOpening(f: FormData) {
  await need(3);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("gl_opening_draft", { p_counter: str(f, "counter", 30) || "500" });
  if (error) await fail(glError(error.message));
  again();
  redirect(`/muhasebe/fisler/${data}?tamam=${encodeURIComponent("Açılış fişi taslağı oluştu: kontrol edin, stok / demirbaş / sermaye satırlarını ekleyin.")}`);
}

export async function glSaveAccount(f: FormData) {
  await need(2);
  const supabase = await createClient();
  const { error } = await supabase.rpc("gl_account_save", { p: { id: str(f, "id", 40) || null, code: str(f, "code", 40), name: str(f, "name", 160), note: str(f, "note", 500), is_active: f.get("is_active") ? f.get("is_active") === "on" : null } });
  if (error) await fail(glError(error.message));
  again();
  await done("Hesap kaydedildi.");
}

export async function glDeleteAccount(f: FormData) {
  await need(3);
  const supabase = await createClient();
  const { error } = await supabase.rpc("gl_account_delete", { p_id: str(f, "id", 40) });
  if (error) await fail(glError(error.message));
  again();
  await done("Hesap silindi.");
}

/** Hesap planını içe aktar: her satır "kod;ad" ya da "kod<TAB>ad" (Excel'den yapıştırma) */
export async function glImportAccounts(f: FormData) {
  await need(2);
  const supabase = await createClient();
  const rows = str(f, "rows", 200000).split(/\r?\n/).map((l) => l.split(/\t|;/).map((x) => x.trim())).filter((r) => r[0] && r[1]);
  rows.sort((a, b) => a[0]!.split(".").length - b[0]!.split(".").length || a[0]!.localeCompare(b[0]!));
  const { data: have } = await supabase.from("gl_accounts").select("id, code");
  const ids = new Map(((have ?? []) as Array<{ id: string; code: string }>).map((a) => [a.code, a.id]));
  let ok = 0; const bad: string[] = [];
  for (const [code, name] of rows) {
    const { error } = await supabase.rpc("gl_account_save", { p: { id: ids.get(code!) ?? null, code, name } });
    if (error) bad.push(`${code}: ${glError(error.message)}`); else ok++;
  }
  again();
  if (bad.length) await fail(`${ok} hesap kaydedildi, ${bad.length} satır atlandı. ${bad.slice(0, 3).join(" · ")}`);
  await done(`${ok} hesap kaydedildi.`);
}

export async function glSaveMap(f: FormData) {
  await need(3);
  const supabase = await createClient();
  const { error } = await supabase.rpc("gl_map_save", { p_source: str(f, "source", 30), p_key: str(f, "key", 80), p_code: str(f, "code", 40) });
  if (error) await fail(glError(error.message));
  again();
  await done("Eşleştirme kaydedildi. Bekleyen kayıtlar için \"Yeniden dene\"ye basın.");
}

export type VoucherState = { ok: boolean; message: string; id?: string } | null;
/** Elle fiş: satırlar JSON (tutarlar metin, TL) */
export async function glSaveVoucher(_: VoucherState, f: FormData): Promise<VoucherState> {
  const s = await getSession();
  if ((s.modules.ledger ?? 0) < 2) return { ok: false, message: "Bu işlem için genel muhasebe yetkiniz yok." };
  let lines: Array<{ code: string; debit: string; credit: string; description: string }> = [];
  try { lines = JSON.parse(str(f, "lines", 200000) || "[]"); } catch { return { ok: false, message: "Satırlar okunamadı." }; }
  const payload = {
    id: str(f, "id", 40) || null, date: str(f, "date", 10), kind: str(f, "kind", 20), description: str(f, "description", 500),
    doc_type: str(f, "doc_type", 20) || null, doc_no: str(f, "doc_no", 60) || null, doc_date: str(f, "doc_date", 10) || null,
    lines: lines.filter((l) => l.code.trim()).map((l) => ({ code: l.code.trim(), debit: parseAmount(l.debit) ?? 0, credit: parseAmount(l.credit) ?? 0, description: l.description })),
  };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("gl_voucher_save", { p: payload });
  if (error) return { ok: false, message: glError(error.message) };
  again();
  return { ok: true, message: "Fiş kaydedildi.", id: data as string };
}

export async function glCancelVoucher(f: FormData) {
  await need(2);
  const supabase = await createClient();
  const { error } = await supabase.rpc("gl_voucher_cancel", { p_id: str(f, "id", 40) });
  if (error) await fail(glError(error.message));
  again();
  await done("Fiş iptal edildi.");
}

export async function glRenumber(f: FormData) {
  await need(3);
  const y = Number(str(f, "year", 4));
  if (!(y > 2000 && y < 2100)) await fail("Geçersiz yıl.");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("gl_renumber", { p_year: y });
  if (error) await fail(glError(error.message));
  again();
  await done(`${y} yılı yevmiye maddeleri numaralandı (${data ?? 0} madde).`);
}

async function rpcDone(fn: string, args: Record<string, unknown>, ok: (d: unknown) => string, level = 2) {
  await need(level);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(fn, args);
  if (error) await fail(glError(error.message));
  again();
  await done(ok(data));
}

export async function glVatClose(f: FormData) {
  const m = str(f, "month", 7);
  await rpcDone("gl_vat_close", { p_month: m }, () => `${m} KDV mahsup fişi oluştu.`);
}
export async function glPayrollAccrual(f: FormData) {
  const p = str(f, "period", 7);
  await rpcDone("gl_payroll_accrual", { p_period: p, p_expense: str(f, "expense", 30) || "770" }, () => `${p} bordro tahakkuk fişi oluştu.`);
}
export async function glFxRevalue(f: FormData) {
  await rpcDone("gl_fx_revalue", { p_date: str(f, "date", 10) }, (d) => { const x = d as { gain?: number; loss?: number; empty?: boolean }; return x.empty ? "Değerlenecek döviz bakiyesi yok." : `Kur değerleme fişi oluştu (kâr ${((x.gain ?? 0) / 100).toLocaleString("tr-TR")} TL, zarar ${((x.loss ?? 0) / 100).toLocaleString("tr-TR")} TL).`; });
}
export async function glCloseYear(f: FormData) {
  const y = Number(str(f, "year", 4));
  await rpcDone("gl_close_year", { p_year: y }, (d) => { const x = d as { net_profit?: number }; return `${y} yılı kapandı; ${y + 1} açılış fişi oluştu. Dönem net ${Number(x.net_profit ?? 0) >= 0 ? "kârı" : "zararı"}: ${(Math.abs(Number(x.net_profit ?? 0)) / 100).toLocaleString("tr-TR")} TL.`; }, 3);
}
export async function glUndoClose(f: FormData) {
  const y = Number(str(f, "year", 4));
  await rpcDone("gl_undo_close", { p_year: y }, (d) => `${y} kapanışı geri alındı (${d} fiş iptal).`, 3);
}
export async function glSetLock(f: FormData) {
  const d = str(f, "date", 10) || null;
  await rpcDone("gl_set_lock", { p_date: d }, () => (d ? `Dönem ${d.split("-").reverse().join(".")} tarihine kadar kilitlendi.` : "Dönem kilidi kaldırıldı."), 3);
}

// ---------------------------------------------------------------------
// Beyanname merkezi: KDV iadesi, damga vergisi, vergi takvimi, ihracat belgesi
// ---------------------------------------------------------------------
export async function glVatRefundPost(f: FormData) {
  const m = str(f, "month", 7);
  const amount = parseAmount(str(f, "amount", 20));
  if (!amount) await fail("İade tutarını yazın.");
  await rpcDone("gl_vat_refund_post", { p_month: m, p_amount: amount }, () => `${m} KDV iade alacağı fişi oluştu (136 / 190).`);
}

export async function glStampSave(f: FormData) {
  await need(2);
  const supabase = await createClient();
  const type = str(f, "doc_type", 20);
  const fixed = type === "fixed" ? parseAmount(str(f, "fixed_amount", 20)) : null;
  const base = type === "fixed" ? 0 : parseAmount(str(f, "base", 20));
  if (type === "fixed" && !fixed) await fail("Maktu vergi tutarını yazın.");
  if (type !== "fixed" && !base) await fail("Sözleşme bedelini yazın.");
  const title = str(f, "title", 200);
  if (!title) await fail("Kâğıdın adını yazın (ör. Atölye kira sözleşmesi).");
  const { error } = await supabase.rpc("gl_stamp_save", { p: {
    id: str(f, "id", 40) || null, doc_date: str(f, "doc_date", 10), doc_type: type, title, party_id: str(f, "party_id", 40) || null,
    base, rate_pm: Number(str(f, "rate_pm", 12).replace(",", ".")) || 0, fixed_amount: fixed, share_pct: Number(str(f, "share_pct", 6).replace(",", ".")) || 100, note: str(f, "note", 500),
  } });
  if (error) await fail(glError(error.message));
  again();
  await done("Damga vergisi kaydı eklendi.");
}

export async function glStampDelete(f: FormData) {
  await rpcDone("gl_stamp_delete", { p_id: str(f, "id", 40) }, () => "Kayıt silindi.");
}

export async function glStampClose(f: FormData) {
  const m = str(f, "month", 7);
  await rpcDone("gl_stamp_close", { p_month: m, p_expense: str(f, "expense", 30) || "770" }, (d) => ((d as { empty?: boolean })?.empty ? "Bu ay damga vergisi yok." : `${m} damga vergisi tahakkuk fişi oluştu.`));
}

const FILING_STATUS = ["todo", "prepared", "filed", "paid", "none"];
export async function glFilingSet(f: FormData) {
  await need(2);
  const status = str(f, "status", 10);
  if (!FILING_STATUS.includes(status)) await fail("Durum geçersiz.");
  const supabase = await createClient();
  const amount = str(f, "amount", 20);
  const { error } = await supabase.rpc("gl_filing_set", { p_kind: str(f, "kind", 10), p_period: str(f, "period", 7), p_status: status, p_amount: amount ? parseAmount(amount) : null, p_note: str(f, "note", 300) || null });
  if (error) await fail(glError(error.message));
  again();
  await done("Durum güncellendi.");
}

export async function invSetExportDoc(f: FormData) {
  const s = await getSession();
  if ((s.modules.finance ?? 0) < 2 && (s.modules.ledger ?? 0) < 2) await fail("Bu işlem için fatura yetkiniz yok.");
  const supabase = await createClient();
  const id = str(f, "id", 40);
  const kind = str(f, "kind", 4) === "gb" ? "gb" : "etgb";
  const { error } = await supabase.rpc("inv_set_export_doc", { p_id: id, p_kind: kind, p_no: str(f, "no", 40), p_date: str(f, "date", 10) || null });
  if (error) await fail(glError(error.message));
  revalidatePath(`/fatura/${id}`);
  again();
  await done("İhracat belgesi kaydedildi.");
}
