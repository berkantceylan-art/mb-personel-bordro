"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import * as XLSX from "xlsx";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import { done, fail } from "@/lib/flash";
import { glError } from "@/lib/gl";
import { LUCA_FIELDS, guessField, type LucaColumn, type LucaField } from "@/lib/luca-gl";

const str = (f: FormData, k: string, max = 300) => String(f.get(k) ?? "").trim().slice(0, max);
const again = () => revalidatePath("/muhasebe/luca", "layout");

async function need(level: number) {
  const s = await getSession();
  if ((s.modules.ledger ?? 0) < level) await fail("Bu işlem için genel muhasebe onay yetkisi gerekir (yönetici / mali müşavir).");
  return s;
}

async function readSheet(f: FormData): Promise<unknown[][]> {
  const file = f.get("file");
  if (!(file instanceof File) || file.size === 0) await fail("Excel dosyası seçin.");
  if ((file as File).size > 8 * 1024 * 1024) await fail("Dosya 8 MB'tan büyük olamaz.");
  try {
    const wb = XLSX.read(await (file as File).arrayBuffer(), { type: "array", cellDates: true });
    const ws = wb.Sheets[wb.SheetNames[0]!];
    if (!ws) throw new Error("sayfa yok");
    return XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, blankrows: false, defval: null });
  } catch (e) {
    return await fail(`Dosya okunamadı: ${(e as Error).message}`);
  }
}

/** Luca'dan "Şablon indir" ile alınan boş fiş şablonu: başlık satırını bulup sütunları eşleştirir */
export async function lucaUploadTemplate(f: FormData) {
  await need(3);
  const rows = await readSheet(f);
  const headRow = rows.slice(0, 15).find((r) => r.filter((c) => typeof c === "string" && c.trim()).length >= 3 && r.some((c) => typeof c === "string" && /hesap/i.test(c)));
  if (!headRow) await fail("Şablonda başlık satırı bulunamadı (\"Hesap Kodu\" gibi başlıkların olduğu satır).");
  const cols: LucaColumn[] = [];
  let last = -1;
  headRow!.forEach((c, i) => { if (typeof c === "string" && c.trim()) last = i; });
  for (let i = 0; i <= last; i++) {
    const h = typeof headRow![i] === "string" ? String(headRow![i]).trim() : "";
    cols.push({ header: h || `Sütun ${i + 1}`, field: h ? guessField(h) : "bos" });
  }
  if (!cols.some((c) => c.field === "hesap_kodu")) await fail("Şablonda hesap kodu sütunu tanınamadı; ayarlardan elle eşleştirin.");
  if (!cols.some((c) => c.field === "fis_no")) cols.unshift({ header: "Fiş No", field: "fis_no" });
  const supabase = await createClient();
  const name = (f.get("file") as File).name.slice(0, 120);
  const { error } = await supabase.rpc("gl_luca_save_settings", { p: { columns: cols, template_name: name } });
  if (error) await fail(glError(error.message));
  again();
  const unknown = cols.filter((c) => c.field === "bos").map((c) => c.header);
  await done(`Şablon okundu: ${cols.length} sütun.${unknown.length ? ` Tanınmayanlar boş bırakılacak: ${unknown.join(", ")} — gerekirse aşağıdan eşleştirin.` : ""}`);
}

/** Sütun eşleştirmesini elle kaydet */
export async function lucaSaveColumns(f: FormData) {
  await need(3);
  const n = Math.min(Number(f.get("n") ?? 0), 40);
  const cols: LucaColumn[] = [];
  for (let i = 0; i < n; i++) {
    const header = str(f, `h${i}`, 80);
    const field = str(f, `f${i}`, 30) as LucaField;
    if (header && field in LUCA_FIELDS) cols.push({ header, field });
  }
  const extraH = str(f, "new_header", 80);
  const extraF = str(f, "new_field", 30) as LucaField;
  if (extraH && extraF in LUCA_FIELDS) cols.push({ header: extraH, field: extraF });
  const supabase = await createClient();
  const { error } = await supabase.rpc("gl_luca_save_settings", { p: { columns: cols } });
  if (error) await fail(glError(error.message));
  again();
  await done("Sütun düzeni kaydedildi.");
}

export async function lucaResetColumns() {
  await need(3);
  const supabase = await createClient();
  const { error } = await supabase.rpc("gl_luca_save_settings", { p: { columns: [], template_name: null } });
  if (error) await fail(glError(error.message));
  again();
  await done("Sütunlar varsayılana döndü.");
}

/** Hariç tutulacak fiş etiketleri, belge türü ve ödeme yöntemi eşlemesi */
export async function lucaSaveRules(f: FormData) {
  await need(3);
  const prefixes = ["vat:", "gecici:", "cit:", "vatrefund:", "stamp:", "payroll:", "reflect:"].filter((p) => f.get(`x_${p}`) === "on");
  const doc_map: Record<string, string> = {};
  for (const k of ["invoice", "check", "note", "receipt", "voucher", "other"]) { const v = str(f, `d_${k}`, 30); if (v) doc_map[k] = v; }
  const pay_map: Record<string, string> = {};
  for (const line of str(f, "pay_map", 2000).split(/\n/)) {
    const m = line.match(/^\s*([0-9.]+)\s*[=:]\s*(.+?)\s*$/);
    if (m) pay_map[m[1]!] = m[2]!.slice(0, 30);
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("gl_luca_save_settings", { p: { exclude_prefixes: prefixes, doc_map, pay_map } });
  if (error) await fail(glError(error.message));
  again();
  await done("Aktarım kuralları kaydedildi.");
}

/** Luca hesap planı (Excel): kod ve ad sütunları otomatik bulunur */
export async function lucaUploadPlan(f: FormData) {
  await need(3);
  const rows = await readSheet(f);
  const hi = rows.slice(0, 15).findIndex((r) => r.some((c) => typeof c === "string" && /kod/i.test(c)));
  let ci = 0, ni = 1, start = 0;
  if (hi >= 0) {
    const h = rows[hi]!.map((c) => (typeof c === "string" ? c.toLocaleLowerCase("tr-TR") : ""));
    ci = h.findIndex((x) => /kod/.test(x));
    const n = h.findIndex((x, i) => i !== ci && /(ad|isim|açıklama|aciklama|tanım)/.test(x));
    ni = n >= 0 ? n : ci + 1;
    start = hi + 1;
  }
  const out = rows.slice(start).map((r) => ({ code: String(r[ci] ?? "").trim(), name: String(r[ni] ?? "").trim() })).filter((r) => /^[1-9][0-9]{2}/.test(r.code));
  if (!out.length) await fail("Dosyada hesap kodu bulunamadı. İlk sütunda kod, yanında hesap adı olmalı.");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("gl_luca_import_accounts", { p_rows: out.slice(0, 20000) });
  if (error) await fail(glError(error.message));
  again();
  await done(`Luca hesap planı alındı: ${data ?? out.length} hesap.`);
}

export async function lucaMapSet(f: FormData) {
  await need(3);
  const supabase = await createClient();
  const { error } = await supabase.rpc("gl_luca_map_set", { p_erp: str(f, "erp", 40), p_luca: str(f, "luca", 40) });
  if (error) await fail(glError(error.message));
  again();
  await done(`${str(f, "erp", 40)} → ${str(f, "luca", 40) || "aynı kod"} eşleştirildi.`);
}

/** Seçilen fişlerle aktarım paketi oluştur ve indirme sayfasına dön */
export async function lucaExport(f: FormData) {
  await need(3);
  const ids = f.getAll("id").map(String).filter((x) => /^[0-9a-f-]{36}$/.test(x));
  if (!ids.length) await fail("Aktarılacak fiş seçin.");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("gl_luca_export", { p_ids: ids, p_note: str(f, "note", 300) || null });
  if (error) await fail(glError(error.message));
  again();
  redirect(`/muhasebe/luca?paket=${data}&tamam=${encodeURIComponent(`${ids.length} fiş aktarım paketine alındı. Dosyaları indirip Luca'da Excel Veri Aktarımı ekranından yükleyin.`)}`);
}

export async function lucaBatchUndo(f: FormData) {
  await need(3);
  const supabase = await createClient();
  const { error } = await supabase.rpc("gl_luca_batch_undo", { p_batch: str(f, "batch", 40) });
  if (error) await fail(glError(error.message));
  again();
  await done("Paket geri alındı: fişler yeniden aktarılabilir.");
}

export async function lucaAutoMap() {
  await need(3);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("gl_luca_auto_map");
  if (error) await fail(glError(error.message));
  const d = data as { mapped: number; left: number };
  again();
  await done(`${d.mapped} hesap Luca alt hesabıyla eşleştirildi${d.left ? `, ${d.left} hesap için öneri bulunamadı (elle seçin)` : ""}. Eşleştirmeleri ayarlardan kontrol edin.`);
}

/** Luca hesap planını ERP hesap planına aktar (eksik hesaplar açılır, kesin öneriler uygulanır) */
export async function lucaSyncToErp() {
  await need(3);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("gl_luca_sync_to_erp");
  if (error) await fail(glError(error.message));
  const d = data as { created: number; skipped: number; categories: number; redirects: number };
  revalidatePath("/muhasebe", "layout");
  await done(`ERP'de ${d.created} Luca hesabı açıldı${d.skipped ? ` (${d.skipped} hesap üst hesabı olmadığı için atlandı)` : ""}. ${d.categories} kategori ve ${d.redirects} ana hesap öneriye göre bağlandı; kalanları aşağıdan seçin.`);
}

export async function lucaSetRedirect(f: FormData) {
  await need(3);
  const supabase = await createClient();
  const { error } = await supabase.rpc("gl_luca_set_redirect", { p_on: f.get("on") === "1" });
  if (error) await fail(glError(error.message));
  again();
  await done(f.get("on") === "1" ? "Yeni fişler Luca alt hesaplarına yazılacak." : "Yönlendirme kapatıldı.");
}

export async function lucaCategorySet(f: FormData) {
  await need(3);
  const supabase = await createClient();
  const { error } = await supabase.rpc("gl_luca_category_set", { p_cat: str(f, "cat", 40), p_code: str(f, "code", 40) });
  if (error) await fail(glError(error.message));
  revalidatePath("/muhasebe", "layout");
  await done(`Kategori ${str(f, "code", 40) ? `${str(f, "code", 40)} hesabına bağlandı` : "eşleştirmesi kaldırıldı"}.`);
}

export async function lucaApplySuggestions() {
  await need(3);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("gl_luca_apply_suggestions");
  if (error) await fail(glError(error.message));
  const d = data as { categories: number; redirects: number };
  revalidatePath("/muhasebe", "layout");
  await done(`${d.categories} kategori ve ${d.redirects} ana hesap öneriye göre bağlandı.`);
}
