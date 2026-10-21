"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

/** Tedarikçi cari grubu: fişli (iskontolu) + iskontosuz fişli + KDV carisi, kalemli fiş, iskonto, ekstre aktarımı */

export type GroupState = { ok?: boolean; message: string };
const MIG = "20270267000000_supplier_cari_group.sql";
const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

function err(m: string): string {
  if (/sup_group|sup_slip_entry|sup_statement|sup_discount|sup_item_price|sub_kind|schema cache/.test(m) && /function|column|does not exist|schema cache/.test(m)) return `Supabase'de ${MIG} çalıştırılmalı.`;
  if (/not_allowed/.test(m)) return "Yetkiniz yok.";
  if (/twin_has_moves|nodisc_has_moves/.test(m)) return "Fişli carinin hareketi olduğu için para birimi buradan değişmez. Firma ekstresindeki \"Fişli carileri EUR yap\" düğmesini kullanın.";
  if (/has_mirror/.test(m)) return "Fişli cariye ERP'den girilmiş ödeme yansıması var; birim değişirse tutar bozulur. Önce o ödemeleri iptal edin, sonra tekrar deneyin.";
  if (/nodisc_missing/.test(m)) return "İskontosuz fişli cari açılmamış. Önce Grup ayarlarından açın.";
  if (/group_member_missing:(\w+)/.test(m)) return `Cari grubu eksik (${m.match(/group_member_missing:(\w+)/)![1]}). Önce Grup ayarlarından iskontosuz fişli ve KDV carisini açın.`;
  if (/rate_missing:(\w+)/.test(m)) return `${m.match(/rate_missing:(\w+)/)![1]} kuru yok. Finans › Döviz kurları'ndan TCMB kurlarını çekin.`;
  if (/lines_required/.test(m)) return "En az bir kalem girin (ürün ve miktar).";
  if (/amount_required/.test(m)) return "Tutar sıfırdan büyük olmalı.";
  if (/warehouse_required/.test(m)) return "Stoğa eklemek için önce bir depo tanımlayın.";
  if (/main_required/.test(m)) return "Grup, firmanın faturalı (asıl) carisinden kurulur.";
  return m;
}

function done(main: string) {
  revalidatePath(`/finans/fis-cari/${main}`, "layout");
  revalidatePath("/finans/fis-cari");
  revalidatePath("/finans/cariler", "layout");
}

export async function setupGroup(_: GroupState | null, f: FormData): Promise<GroupState> {
  const main = s(f, "main");
  const pct = Number(s(f, "discount").replace(",", ".") || "0");
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) return { ok: false, message: "İskonto oranı 0 ile 100 arasında olmalı." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("sup_group_setup", {
    p_main: main, p_slip_currency: s(f, "currency") || "TRY", p_discount: pct, p_nodisc: f.get("nodisc") === "on", p_vat: f.get("vat") === "on",
  });
  if (error) return { ok: false, message: err(error.message) };
  done(main);
  return { ok: true, message: "Cari grubu kaydedildi." };
}

export type ItemRouteRow = { supplier_name: string; route: "slip" | "nodisc"; price?: number | null; currency?: string; unit?: string | null; is_active?: boolean };

export async function saveItemRoutes(main: string, rows: ItemRouteRow[]): Promise<GroupState> {
  if (!rows.length) return { ok: true, message: "Değişiklik yok." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("sup_item_price_save", { p_main: main, p: rows });
  if (error) return { ok: false, message: err(error.message) };
  done(main);
  return { ok: true, message: `${data ?? rows.length} ürün güncellendi.` };
}

export type EntryLine = { item_id?: string | null; name: string; qty: number; unit?: string | null; price?: number | null; currency?: string; route?: "slip" | "nodisc" };
export type EntryResult = { ok: boolean; message: string; slips?: { slip_id: string; party: string; role: string; amount: number; currency: string }[] };

export async function saveSlipEntry(p: { party_id: string; slip_date: string; doc_no: string; note: string; photo?: string | null; add_stock: boolean; warehouse_id?: string | null; lines: EntryLine[] }): Promise<EntryResult> {
  const lines = p.lines.filter((l) => l.name.trim() && Number(l.qty) !== 0);
  if (!lines.length) return { ok: false, message: "En az bir kalem girin (ürün ve miktar)." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("sup_slip_entry", { p: { ...p, lines } });
  if (error) return { ok: false, message: err(error.message) };
  done(p.party_id);
  revalidatePath("/stok", "layout");
  const slips = (data ?? []) as EntryResult["slips"];
  return { ok: true, message: "Fiş kaydedildi.", slips };
}

export async function postDiscount(_: GroupState | null, f: FormData): Promise<GroupState> {
  const party = s(f, "party_id");
  const amt = Math.round(Number(s(f, "amount").replace(/\./g, "").replace(",", ".")) * 100);
  if (!Number.isFinite(amt) || amt <= 0) return { ok: false, message: "İskonto tutarını sayı olarak yazın (ör. 6.319,00)." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("sup_discount_post", { p_party: party, p_date: s(f, "date") || null, p_amount: amt, p_note: s(f, "note") || "İskonto", p_doc: s(f, "doc") || null });
  if (error) return { ok: false, message: err(error.message) };
  done(s(f, "main") || party);
  return { ok: true, message: "İskonto fişli cariye işlendi." };
}

export async function statementOverlap(main: string, from: string, to: string): Promise<Record<string, number> | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("sup_statement_overlap", { p_main: main, p_from: from, p_to: to });
  if (error) return null;
  return (data ?? {}) as Record<string, number>;
}

export type ImportResult = { ok: boolean; message: string; counts?: Record<string, number> };

export async function importStatement(main: string, payload: unknown): Promise<ImportResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("sup_statement_import", { p_main: main, p: payload });
  if (error) return { ok: false, message: err(error.message) };
  done(main);
  revalidatePath("/stok", "layout");
  return { ok: true, message: "Ekstre aktarıldı.", counts: data as Record<string, number> };
}

export async function vatBackfill(_: GroupState | null, f: FormData): Promise<GroupState> {
  const main = s(f, "main");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("sup_vat_backfill", { p_main: main, p_from: s(f, "from") || null });
  if (error) return { ok: false, message: err(error.message) };
  done(main);
  return { ok: true, message: data ? `${data} faturanın KDV'si KDV carisine yazıldı.` : "Yazılacak fatura bulunamadı (KDV'si zaten yazılmış ya da ekstreden aktarılmış)." };
}

// ---------------------------------------------------------------- silme
const DEL_MIG = "20270268000000_supplier_group_delete.sql";
function delErr(m: string): string {
  if (/sup_row_delete|sup_import_undo|sup_group_remove/.test(m) && /function|does not exist|schema cache/.test(m)) return `Supabase'de ${DEL_MIG} çalıştırılmalı.`;
  if (/use_invoice_cancel/.test(m)) return "Bu satır bir alış faturası: faturayı Alış faturaları ekranından iptal edin.";
  if (/has_payments:(\d+)/.test(m)) return `Fişli carilere doğrudan girilmiş ${m.match(/has_payments:(\d+)/)![1]} ödeme (kasa / banka hareketi) var. Önce bu ödemeleri satırlarındaki "Sil" ile iptal edin, sonra tekrar deneyin.`;
  if (/not_in_group/.test(m)) return "Bu kayıt bu firmanın carilerine ait değil.";
  if (/violates foreign key/.test(m)) return "Bu carilere bağlı başka kayıtlar var (çek, sipariş, fatura vb.); önce onları iptal edin.";
  return err(m);
}
const back = (main: string, msg: string, ok = true) => `/finans/fis-cari/${main}?${ok ? "tamam" : "hata"}=${encodeURIComponent(msg)}`;

/** Ekstredeki tek satırı sil (fiş, ödeme, iskonto, aktarılan satır) */
export async function deleteGroupRow(f: FormData) {
  const main = s(f, "main"), txn = s(f, "txn");
  const { redirect } = await import("next/navigation");
  const { data, error } = await (await createClient()).rpc("sup_row_delete", { p_main: main, p_txn: txn });
  done(main);
  redirect(error ? back(main, delErr(error.message), false) : back(main, data === "already" ? "Bu satır zaten silinmiş." : "Satır silindi."));
}

/** Ekstre aktarımını geri al */
export async function undoGroupImport(f: FormData) {
  const main = s(f, "main");
  const { redirect } = await import("next/navigation");
  const { data, error } = await (await createClient()).rpc("sup_import_undo", { p_main: main });
  done(main);
  const r = data as { slips: number; txns: number } | null;
  redirect(error ? back(main, delErr(error.message), false) : back(main, `Aktarım geri alındı: ${r?.slips ?? 0} fiş ve ${r?.txns ?? 0} hareket silindi. Ekstreyi yeniden yükleyebilirsiniz.`));
}

/** Firmanın fişli carilerini (fişli, iskontosuz fişli, KDV) sil; faturalı cari kalır */
export async function removeGroupParties(f: FormData) {
  const main = s(f, "main");
  const { redirect } = await import("next/navigation");
  const { data, error } = await (await createClient()).rpc("sup_group_remove", { p_main: main, p_force: true });
  done(main);
  const r = data as { removed: number; slips: number; txns: number } | null;
  redirect(error ? back(main, delErr(error.message), false) : `/finans/fis-cari?tamam=${encodeURIComponent(`${r?.removed ?? 0} fişli cari silindi (${r?.slips ?? 0} fiş, ${r?.txns ?? 0} hareketle). Faturalı cari duruyor.`)}`);
}

/** Tedarikçinin "Cari Hareket Dökümü" PDF'leri → ekstre aktarımının okuduğu sayfalar (her PDF bir cari) */
export async function pdfStatementSheets(fd: FormData): Promise<{ ok: boolean; message?: string; sheets?: Record<string, unknown[][]>; files?: { name: string; book: string; title: string; closing: number | null }[] }> {
  try {
    const { parseSupplierPdf, pdfSheetsToWorkbook } = await import("@/lib/supplier-pdf");
    const files = fd.getAll("files").filter((x): x is File => x instanceof File && x.size > 0 && /\.pdf$/i.test(x.name));
    if (!files.length) return { ok: false, message: "PDF seçin." };
    const list = [];
    const info = [];
    for (const f of files.slice(0, 8)) {
      try {
        const s = await parseSupplierPdf(new Uint8Array(await f.arrayBuffer()), f.name);
        list.push(s); info.push({ name: f.name, book: s.book, title: s.title, closing: s.closing });
      } catch (e) { return { ok: false, message: `${f.name}: ${e instanceof Error ? e.message : String(e)}` }; }
    }
    return { ok: true, sheets: pdfSheetsToWorkbook(list), files: info };
  } catch (e) { return { ok: false, message: e instanceof Error ? e.message : String(e) }; }
}

/** Fişli ve iskontosuz fişli cari yanlış para birimiyle (TL) açılıp hareket aldıysa EUR yap: tutarlar aynı kalır, birim düzelir */
export async function setGroupCurrency(f: FormData) {
  const main = s(f, "main");
  const cur = s(f, "cur") || "EUR";
  const sb = await createClient();
  const { data, error } = await sb.rpc("sup_group_set_currency", { p_main: main, p_cur: cur });
  done(main);
  const { redirect } = await import("next/navigation");
  if (error) redirect(`/finans/fis-cari/${main}?hata=${encodeURIComponent(/sup_group_set_currency|schema cache/.test(error.message) ? "Supabase'de 20270269000000_supplier_currency_fix.sql çalıştırılmalı." : err(error.message))}`);
  const r = data as { parties: number; moves?: number };
  redirect(`/finans/fis-cari/${main}?tamam=${encodeURIComponent(r.parties ? `${r.parties} fişli cari ${cur} yapıldı (${r.moves ?? 0} hareket).` : "Fişli cariler zaten " + cur + ".")}`);
}
