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

// ---------------------------------------------------------------------
// Geçici vergi ve kurumlar vergisi
// ---------------------------------------------------------------------
export async function glCitPost(f: FormData) {
  const y = Number(str(f, "year", 4));
  const q = Number(str(f, "q", 1));
  await rpcDone("gl_cit_post", { p_year: y, p_q: q }, (d) => {
    const x = d as { tax?: number; payable?: number };
    const tl = (v?: number) => (Number(v ?? 0) / 100).toLocaleString("tr-TR", { minimumFractionDigits: 2 });
    return q < 4 ? `${y}/${q}. dönem geçici vergi fişi oluştu: ödenecek ${tl(x.payable)} TL.` : `${y} kurumlar vergisi karşılık fişi oluştu: vergi ${tl(x.tax)} TL, mahsup sonrası ${tl(x.payable)} TL.`;
  });
}

export async function glKkegSet(f: FormData) {
  const pct = Number(str(f, "pct", 6).replace(",", "."));
  await rpcDone("gl_kkeg_set", { p_code: str(f, "code", 40), p_pct: Number.isFinite(pct) ? pct : -1 }, () => (pct > 0 ? "KKEG oranı kaydedildi." : "Hesap KKEG listesinden çıkarıldı."));
}

export async function glTaxAdjSave(f: FormData) {
  const amount = parseAmount(str(f, "amount", 20));
  if (!amount) await fail("Tutarı yazın.");
  const description = str(f, "description", 200);
  if (!description) await fail("Açıklama yazın.");
  await rpcDone("gl_tax_adj_save", { p: { adj_date: str(f, "adj_date", 10), kind: str(f, "kind", 12), description, amount, min_allowed: f.get("min_allowed") === "on" } }, () => "Düzeltme eklendi.");
}

export async function glTaxAdjDelete(f: FormData) {
  await rpcDone("gl_tax_adj_delete", { p_id: str(f, "id", 40) }, () => "Düzeltme silindi.");
}

// ---------------------------------------------------------------------
// Dönem sonu işlemleri
// ---------------------------------------------------------------------
const tl = (v?: number) => (Number(v ?? 0) / 100).toLocaleString("tr-TR", { minimumFractionDigits: 2 });

export async function glDepreciationRun(f: FormData) {
  const s = await getSession();
  if ((s.modules.assets ?? 0) < 2) await fail("Amortisman için demirbaş modülünde düzenleme yetkisi gerekir.");
  const m = str(f, "month", 7);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("asset_depreciation_run", { p_period: `${m}-01` });
  if (error) await fail(glError(error.message));
  const d = data as { count: number; total: number };
  again();
  await done(d.count ? `${m} amortismanı ayrıldı: ${d.count} demirbaş, ${tl(d.total)} TL.` : "Bu ay amortisman ayrılacak demirbaş yok (zaten ayrılmış olabilir).");
}
export async function glReflectMonth(f: FormData) {
  const m = str(f, "month", 7);
  await rpcDone("gl_reflect_month", { p_month: m }, (d) => ((d as { empty?: boolean }).empty ? "Yansıtılacak gider yok." : `${m} yansıtma fişi oluştu.`));
}
export async function glDeferralsRun(f: FormData) {
  const m = str(f, "month", 7);
  await rpcDone("gl_deferrals_run", { p_month: m }, (d) => ((d as { empty?: boolean }).empty ? "Bu ay dönemsellik payı yok." : `${m} dönemsellik fişi oluştu.`));
}
export async function glDeferralSave(f: FormData) {
  const total = parseAmount(str(f, "total", 20));
  if (!total) await fail("Toplam tutarı yazın.");
  const months = Number(str(f, "months", 4));
  if (!(months >= 2 && months <= 120)) await fail("Süre 2 ile 120 ay arasında olmalı.");
  const description = str(f, "description", 200);
  if (!description) await fail("Açıklama yazın.");
  await rpcDone("gl_deferral_save", { p: { kind: str(f, "kind", 10) === "income" ? "income" : "expense", description, total, start_month: `${str(f, "start_month", 7)}-01`, months, pl_code: str(f, "pl_code", 20) || "770", setup_date: str(f, "setup_date", 10) || null } }, () => "Dönemsellik kaydı ve kurulum fişi oluştu.");
}
export async function glDeferralDelete(f: FormData) {
  await rpcDone("gl_deferral_delete", { p_id: str(f, "id", 40) }, () => "Dönemsellik kaydı silindi.");
}
export async function glLoanAccrual(f: FormData) {
  const m = str(f, "month", 7);
  await rpcDone("gl_loan_accrual", { p_month: m }, (d) => `Kredi faiz tahakkuku: ${tl((d as { accrued?: number }).accrued)} TL (ertesi ay ters kaydı da oluştu).`);
}
export async function glPartnerReclass(f: FormData) {
  const y = Number(str(f, "year", 4));
  await rpcDone("gl_partner_reclass", { p_year: y }, (d) => { const x = d as { accounts?: number; amount?: number }; return x.accounts ? `${x.accounts} ortak hesabı 131'e aktarıldı: ${tl(x.amount)} TL.` : "Borç bakiyeli ortak hesabı yok."; });
}
export async function glRevalPost(f: FormData) {
  const rate = Number(str(f, "rate", 10).replace(",", "."));
  await rpcDone("gl_reval_post", { p_date: str(f, "date", 10), p_rate: Number.isFinite(rate) ? rate : 0 }, (d) => { const x = d as { assets?: number; fund?: number }; return x.assets ? `Yeniden değerleme yapıldı: ${x.assets} demirbaş, değer artışı ${tl(x.fund)} TL (522).` : "Yeniden değerlenecek demirbaş yok."; });
}
export async function glRevalUndo(f: FormData) {
  await rpcDone("gl_reval_undo", { p_date: str(f, "date", 10) }, (d) => `${d} demirbaşın yeniden değerlemesi geri alındı.`, 3);
}

// ---------------------------------------------------------------------
// Karşılıklar ve mutabakat
// ---------------------------------------------------------------------
export async function glRediscountPost(f: FormData) {
  const rate = Number(str(f, "rate", 10).replace(",", "."));
  await rpcDone("gl_rediscount_post", { p_date: str(f, "date", 10), p_rate: Number.isFinite(rate) ? rate : 0, p_cheques: f.get("cheques") === "1" },
    (d) => { const x = d as { receivable?: number; payable?: number }; return `Reeskont fişi oluştu: alacak ${tl(x.receivable)} TL, borç ${tl(x.payable)} TL (ertesi gün ters kaydı da oluştu).`; });
}
export async function glSeverancePost(f: FormData) {
  const cap = parseAmount(str(f, "cap", 20));
  await rpcDone("gl_severance_post", { p_date: str(f, "date", 10), p_cap: cap, p_expense: str(f, "expense", 30) || "770" },
    (d) => { const x = d as { total?: number; diff?: number }; return `Kıdem tazminatı karşılığı: toplam ${tl(x.total)} TL, bu fişle ${Number(x.diff ?? 0) >= 0 ? "eklenen" : "iptal edilen"} ${tl(Math.abs(Number(x.diff ?? 0)))} TL (vergi hesabına KKEG olarak yazıldı).`; });
}
export async function glDoubtfulAdd(f: FormData) {
  const amount = parseAmount(str(f, "amount", 20));
  if (!amount) await fail("Tutarı yazın.");
  await rpcDone("gl_doubtful_add", { p: { party_id: str(f, "party_id", 40), doubt_date: str(f, "date", 10), amount, reason: str(f, "reason", 10) || "diger", note: str(f, "note", 300) } }, () => "Şüpheli alacak ve karşılık fişi oluştu (128 / 129 / 654).");
}
export async function glDoubtfulCollect(f: FormData) {
  const amount = parseAmount(str(f, "amount", 20));
  if (!amount) await fail("Tahsil edilen tutarı yazın.");
  await rpcDone("gl_doubtful_collect", { p_id: str(f, "id", 40), p_amount: amount, p_date: str(f, "date", 10) || null }, () => "Tahsilat işlendi; karşılık iptal edildi (644). Parayı finansta tahsilat olarak da girin.");
}
export async function glCashCount(f: FormData) {
  const s = await getSession();
  if ((s.modules.finance ?? 0) < 2 && (s.modules.ledger ?? 0) < 2) await fail("Bu işlem için finans yetkiniz yok.");
  const counted = parseAmount(str(f, "counted", 20));
  if (counted === null) await fail("Sayılan tutarı yazın.");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("gl_cash_count", { p: { account_id: str(f, "account_id", 40), count_date: str(f, "date", 10), counted, counted_by: str(f, "counted_by", 120), note: str(f, "note", 300) } });
  if (error) await fail(glError(error.message));
  const d = data as { diff: number };
  revalidatePath("/finans", "layout");
  again();
  await done(d.diff === 0 ? "Kasa sayımı kaydedildi: fark yok." : `Kasa sayımı kaydedildi: ${d.diff < 0 ? "noksan" : "fazla"} ${tl(Math.abs(d.diff))} TL kasaya işlendi (${d.diff < 0 ? "197" : "397"}).`);
}

// ---------------------------------------------------------------------
// Fiş gelen kutusu (onaylı çalışma)
// ---------------------------------------------------------------------
const ids = (f: FormData) => f.getAll("ids").map((x) => String(x)).filter((x) => /^[0-9a-f-]{36}$/.test(x)).slice(0, 500);

export async function glApprove(f: FormData) {
  const list = ids(f);
  if (!list.length) await fail("Onaylanacak fiş seçin.");
  await rpcDone("gl_approve", { p_ids: list }, (d) => { const x = d as { approved: number; skipped: number }; return `${x.approved} fiş onaylandı${x.skipped ? `, ${x.skipped} fiş atlandı (dengesiz ya da kilitli dönem)` : ""}.`; }, 3);
}
export async function glApproveGreen(f: FormData) {
  await rpcDone("gl_approve_green", { p_from: str(f, "from", 10), p_to: str(f, "to", 10) }, (d) => { const x = d as { approved: number; skipped: number }; return `${x.approved} yeşil fiş onaylandı${x.skipped ? `, ${x.skipped} atlandı` : ""}.`; }, 3);
}
export async function glUnapprove(f: FormData) {
  await rpcDone("gl_unapprove", { p_id: str(f, "id", 40) }, () => "Onay geri alındı; fiş tekrar gelen kutusunda.", 3);
}
export async function glInboxMapCategory(f: FormData) {
  const code = str(f, "code", 40);
  if (!code) await fail("Hesap kodunu yazın.");
  await rpcDone("gl_inbox_map_category", { p_category: str(f, "category_id", 40), p_code: code }, (d) => `Kural kaydedildi: bu kategori bundan sonra ${code} hesabına işlenecek. ${(d as { refreshed: number }).refreshed} fiş yenilendi.`, 3);
}
export async function glLineSetAccount(f: FormData) {
  const code = str(f, "code", 40);
  if (!code) await fail("Hesap kodunu yazın.");
  await rpcDone("gl_line_set_account", { p_line: str(f, "line_id", 40), p_code: code }, () => `Satır ${code} hesabına alındı (yalnız bu fişte).`, 3);
}
export async function glInboxExclude(f: FormData) {
  const on = str(f, "on", 1) !== "0";
  await rpcDone("gl_inbox_exclude", { p_id: str(f, "id", 40), p_note: str(f, "note", 200) || null, p_on: on }, () => (on ? "Fiş muhasebe dışı sayıldı." : "Fiş yeniden oluşturuldu ve gelen kutusuna alındı."), 3);
}
export async function glSetApprovalMode(f: FormData) {
  const on = str(f, "on", 1) === "1";
  await rpcDone("gl_set_approval_mode", { p_on: on }, () => (on ? "Onaylı çalışma açıldı: yeni fişler onayınıza düşecek." : "Onaylı çalışma kapatıldı: fişler doğrudan kaydedilecek (bekleyen taslakları onaylamayı unutmayın)."), 3);
}
