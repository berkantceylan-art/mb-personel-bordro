"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import { done, fail } from "@/lib/flash";
import type { BankRow } from "@/lib/bank-parse";

const str = (f: FormData, k: string, max = 200) => String(f.get(k) ?? "").trim().slice(0, max);
const ID = /^[0-9a-f-]{36}$/;
const err = (m: string) =>
  /not_allowed|permission/.test(m) ? "Finans yetkiniz yok (Yönetim > Yetkiler)."
  : /already_done/.test(m) ? "Bu satır zaten işlenmiş."
  : /target_required/.test(m) ? "Cari ya da gelir / gider kategorisi seçin."
  : /too_many/.test(m) ? "Tek seferde en çok 3000 satır yüklenebilir."
  : /empty/.test(m) ? "Dosyada hareket bulunamadı."
  : /rate_missing/.test(m) ? "Döviz kuru yok: Finans > Kurlar'dan kur girin."
  : /bad_date/.test(m) ? "Mutabakat tarihi bugünden ileri olamaz."
  : /fin_bank|fin_recon|schema cache/.test(m) ? "Supabase'de 20261225000000_bank_recon.sql çalıştırılmalı."
  : m;

async function need() {
  const s = await getSession();
  if ((s.modules.finance ?? 0) < 2) await fail(err("not_allowed"));
}

export async function importBankRows(accountId: string, fileName: string, rows: BankRow[]): Promise<{ ok: boolean; message: string }> {
  const s = await getSession();
  if ((s.modules.finance ?? 0) < 2) return { ok: false, message: err("not_allowed") };
  if (!ID.test(accountId)) return { ok: false, message: "Hesap seçin." };
  const clean = rows
    .filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.date) && Number.isFinite(r.amount) && r.amount !== 0)
    .map((r) => ({ date: r.date, description: String(r.description ?? "").slice(0, 500), amount: Math.round(r.amount), balance: r.balance === null || !Number.isFinite(r.balance) ? null : Math.round(r.balance), ref: r.ref ? String(r.ref).slice(0, 80) : null }));
  if (!clean.length) return { ok: false, message: err("empty") };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("fin_bank_import", { p_account: accountId, p_file: fileName.slice(0, 200), p_rows: clean });
  if (error) return { ok: false, message: err(error.message) };
  const d = data as { rows: number; added: number; matched: number; suggested: number };
  revalidatePath("/finans/banka-aktar");
  return { ok: true, message: `${d.added} yeni hareket eklendi${d.rows - d.added > 0 ? ` (${d.rows - d.added} satır zaten vardı)` : ""}. ${d.matched} tanesi kayıtlı işlemle eşleşti, ${d.suggested} tanesi için cari / kategori önerildi.` };
}

export async function postBankLine(f: FormData) {
  await need();
  const target = str(f, "target", 60);
  const [kind, id] = target.split(":");
  const supabase = await createClient();
  const { error } = await supabase.rpc("fin_bank_post", {
    p_line: str(f, "id", 40),
    p_party: kind === "p" && ID.test(id ?? "") ? id : null,
    p_category: kind === "c" && ID.test(id ?? "") ? id : null,
    p_book: ["official", "both"].includes(str(f, "book", 10)) ? str(f, "book", 10) : null,
    p_rule: str(f, "rule", 80) || null,
  });
  if (error) await fail(err(error.message));
  revalidatePath("/finans/banka-aktar");
}

/** Önerisi olan tüm bekleyen satırları işle */
export async function postSuggested(f: FormData) {
  await need();
  const account = str(f, "account", 40);
  const supabase = await createClient();
  const { data } = await supabase.from("fin_bank_lines").select("id, suggested_party_id, suggested_category_id").eq("account_id", account).eq("status", "new").or("suggested_party_id.not.is.null,suggested_category_id.not.is.null").limit(500);
  let ok = 0, bad = 0;
  for (const l of data ?? []) {
    const { error } = await supabase.rpc("fin_bank_post", { p_line: l.id, p_party: l.suggested_party_id, p_category: l.suggested_party_id ? null : l.suggested_category_id, p_book: null, p_rule: null });
    if (error) bad++; else ok++;
  }
  revalidatePath("/finans/banka-aktar");
  await done(`${ok} hareket işlendi${bad ? `, ${bad} hareket işlenemedi (tek tek kontrol edin)` : ""}.`);
}

export async function markBankLine(f: FormData) {
  await need();
  const supabase = await createClient();
  const { error } = await supabase.rpc("fin_bank_mark", { p_line: str(f, "id", 40), p_action: str(f, "action", 10) });
  if (error) await fail(err(error.message));
  revalidatePath("/finans/banka-aktar");
}

export async function deleteBankRule(f: FormData) {
  await need();
  const supabase = await createClient();
  await supabase.from("fin_bank_rules").delete().eq("id", str(f, "id", 40));
  revalidatePath("/finans/banka-aktar");
}

// ---------------------------------------------------------------------
// Mutabakat
// ---------------------------------------------------------------------
export async function createReconciliations(f: FormData) {
  const s = await getSession();
  if ((s.modules.finance ?? 0) < 2 && (s.modules.sales ?? 0) < 2) await fail(err("not_allowed"));
  const ids = f.getAll("party").map(String).filter((x) => ID.test(x)).slice(0, 500);
  if (!ids.length) await fail("En az bir cari seçin.");
  const book = str(f, "book", 10) === "internal" ? "internal" : "official";
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("fin_recon_create", { p_parties: ids, p_date: str(f, "as_of", 10), p_book: book });
  if (error) await fail(err(error.message));
  revalidatePath("/finans/mutabakat");
  await done(`${data ?? 0} mutabakat mektubu hazırlandı. Bağlantıyı WhatsApp / e-postayla gönderin ya da yazdırın.`);
}

export async function cancelReconciliation(f: FormData) {
  const s = await getSession();
  if ((s.modules.finance ?? 0) < 2 && (s.modules.sales ?? 0) < 2) await fail(err("not_allowed"));
  const supabase = await createClient();
  const { error } = await supabase.rpc("fin_recon_cancel", { p_id: str(f, "id", 40) });
  if (error) await fail(err(error.message));
  revalidatePath("/finans/mutabakat");
}
