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
  const { error } = await supabase.rpc("gl_settings_save", { p: { enabled: f.get("enabled") === "on", start_date: str(f, "start_date", 10) || null, export_format: str(f, "export_format", 20) || null, exclude_codes: codes } });
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
