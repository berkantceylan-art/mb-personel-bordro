"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { done, fail } from "@/lib/flash";
import { parseMoney } from "@/lib/jobs";
import { p3Error } from "@/lib/purchasing3";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const UUID = /^[0-9a-f-]{36}$/i;

function refresh(po?: string) {
  revalidatePath("/satinalma", "layout");
  if (po) revalidatePath(`/alis/siparisler/${po}`);
}

/** Alış faturasını siparişe bağla */
export async function linkInvoice(f: FormData) {
  const inv = str(f, "invoice_id"), po = str(f, "po_id");
  if (!UUID.test(inv) || !UUID.test(po)) await fail("Bağlanacak siparişi seçin.");
  const { error } = await (await createClient()).rpc("pur_invoice_link", { p_invoice: inv, p_po: po });
  if (error) await fail(p3Error(error.message));
  refresh(po);
  await done("Fatura siparişe bağlandı; eşleştirme hesaplandı.");
}

/** Önerilen siparişlere toplu bağla (her fatura için en iyi aday) */
export async function linkSuggested(f: FormData) {
  const pairs = f.getAll("pair").map(String).map((x) => x.split(":")).filter(([a, b]) => UUID.test(a) && UUID.test(b));
  if (!pairs.length) await fail("Bağlanacak fatura seçin.");
  const sb = await createClient();
  let n = 0;
  for (const [inv, po] of pairs) {
    const { error } = await sb.rpc("pur_invoice_link", { p_invoice: inv, p_po: po });
    if (error) await fail(`${n} fatura bağlandı, sonraki hata verdi: ${p3Error(error.message)}`);
    n++;
  }
  refresh();
  await done(`${n} fatura siparişine bağlandı.`);
}

export async function unlinkInvoice(f: FormData) {
  const inv = str(f, "invoice_id");
  const { error } = await (await createClient()).rpc("pur_invoice_link", { p_invoice: inv, p_po: null });
  if (error) await fail(p3Error(error.message));
  refresh(str(f, "po_id") || undefined);
  await done("Faturanın sipariş bağlantısı kaldırıldı.");
}

/** Farkı kabul et / kabulü geri al (yönetici) */
export async function acceptMatch(f: FormData) {
  const po = str(f, "po_id");
  const ok = str(f, "ok") !== "0";
  const { error } = await (await createClient()).rpc("pur_match_accept", { p_po: po, p_ok: ok, p_note: str(f, "note") || null });
  if (error) await fail(p3Error(error.message));
  refresh(po);
  await done(ok ? "Fark kabul edildi; fatura ödemeye uygun." : "Kabul geri alındı.");
}

export async function saveMatchSettings(f: FormData) {
  const tol = Number(str(f, "price_tol").replace(",", "."));
  const qty = Number(str(f, "qty_tol").replace(",", "."));
  const { error } = await (await createClient()).rpc("pur_match_settings_save", {
    p_price_tol: Number.isFinite(tol) ? tol : 2, p_qty_tol: Number.isFinite(qty) ? qty : 0, p_budget_block: f.get("budget_block") === "on",
  });
  if (error) await fail(p3Error(error.message));
  refresh();
  await done("Eşleştirme ve bütçe ayarları kaydedildi.");
}

/** Bütçe ızgarası: alan adı b_<kategori>_<ay>, değer TL */
export async function saveBudget(f: FormData) {
  const year = Number(str(f, "year"));
  if (!(year >= 2000 && year <= 2100)) await fail("Yıl geçersiz.");
  const rows: { category_id: string; month: number; amount: number }[] = [];
  for (const [k, v] of f.entries()) {
    const m = /^b_([0-9a-f-]{36})_(\d{1,2})$/i.exec(k);
    if (!m) continue;
    let raw = String(v).trim().replace(/\s|TL|₺/g, "");
    if (/^\d{1,3}(\.\d{3})+$/.test(raw)) raw = raw.replace(/\./g, ""); // 12.000 → 12000 (binlik ayraç)
    rows.push({ category_id: m[1], month: Number(m[2]), amount: raw ? Math.max(0, parseMoney(raw) ?? 0) : 0 });
  }
  if (!rows.length) await fail("Bütçe satırı yok.");
  const { error } = await (await createClient()).rpc("pur_budget_save", { p_year: year, p: rows });
  if (error) await fail(p3Error(error.message));
  refresh();
  await done("Bütçe kaydedildi.");
}

/** Siparişin gider türü (bütçe kalemi) */
export async function setPOCategory(f: FormData) {
  const id = str(f, "id"), cat = str(f, "category_id");
  const { error } = await (await createClient()).rpc("pur_order_set_category", { p_id: id, p_cat: UUID.test(cat) ? cat : null });
  if (error) await fail(p3Error(error.message));
  refresh(id);
  await done("Gider türü kaydedildi.");
}
