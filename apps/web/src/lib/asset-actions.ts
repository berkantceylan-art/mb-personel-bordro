"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import { done, fail } from "@/lib/flash";
import { dateOk, finError, parseAmount, today } from "@/lib/fin";

const str = (f: FormData, k: string, max = 400) => String(f.get(k) ?? "").trim().slice(0, max);
const opt = (f: FormData, k: string, max = 400) => str(f, k, max) || null;

async function need(level: number) {
  const s = await getSession();
  if ((s.modules.assets ?? 0) < level) await fail("Bu işlem için demirbaş yetkiniz yok (Yönetim > Yetkiler).");
  return s;
}
function assetError(m: string) {
  if (/asset_assigned/.test(m)) return "Demirbaş zimmetli: önce Zimmet sayfasından iade alın.";
  if (/useful_life_months|disposed_on|relation "asset_/.test(m) && /does not exist|schema cache/.test(m)) return "Demirbaş tabloları güncel değil: Supabase'de 20261206000000_expenses_assets.sql çalıştırılmalı.";
  return finError(m);
}
const reval = (id?: string) => { revalidatePath("/demirbas", "layout"); if (id) revalidatePath(`/demirbas/${id}`); revalidatePath("/zimmet"); revalidatePath("/finans", "layout"); };

/** Muhasebe alanları: maliyet, ömür, hurda değer, amortisman başlangıcı, bakım, garanti */
export async function saveAssetFinance(form: FormData) {
  await need(2);
  const id = str(form, "id", 40);
  const supabase = await createClient();
  const life = Number(str(form, "useful_life_years").replace(",", ".")) || 0;
  const { error } = await supabase.from("assets").update({
    value: parseAmount(str(form, "value")), purchase_date: dateOk(str(form, "purchase_date")), salvage_value: parseAmount(str(form, "salvage_value")) ?? 0,
    useful_life_months: life > 0 ? Math.round(life * 12) : null, depreciation_method: str(form, "depreciation_method") === "none" ? "none" : "straight",
    depreciation_start: dateOk(str(form, "depreciation_start")), location: opt(form, "location", 120), supplier_party_id: opt(form, "supplier_party_id", 40),
    invoice_id: opt(form, "invoice_id", 40), warranty_until: dateOk(str(form, "warranty_until")),
    maintenance_interval_months: Number(str(form, "maintenance_interval_months")) || null, next_maintenance: dateOk(str(form, "next_maintenance")), updated_at: new Date().toISOString(),
  }).eq("id", id);
  if (error) await fail(assetError(error.message));
  if (form.get("post_opening") === "on") {
    const { error: e2 } = await supabase.rpc("asset_open_post", { p_asset: id });
    if (e2) await fail(assetError(e2.message));
  }
  reval(id);
  await done("Demirbaş bilgileri kaydedildi.");
}

export async function runDepreciation(form: FormData) {
  await need(2);
  const period = dateOk(str(form, "period") + "-01") ?? today();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("asset_depreciation_run", { p_period: period });
  if (error) await fail(assetError(error.message));
  const r = data as { count: number; total: number };
  reval();
  await done(r.count ? `${r.count} demirbaş için ${(r.total / 100).toLocaleString("tr-TR", { minimumFractionDigits: 2 })} ₺ amortisman işlendi.` : "Bu dönem için işlenecek amortisman yok (zaten işlenmiş ya da tamamlanmış).");
}

export async function undoDepreciation(form: FormData) {
  await need(3);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("asset_depreciation_undo", { p_period: str(form, "period", 10) });
  if (error) await fail(assetError(error.message));
  reval();
  await done(`${data ?? 0} satır geri alındı.`);
}

export async function addMaintenance(form: FormData) {
  await need(2);
  const id = str(form, "asset_id", 40);
  const supabase = await createClient();
  const pay = str(form, "pay");
  const { error } = await supabase.rpc("asset_maintenance_add", {
    p: {
      asset_id: id, done_on: dateOk(str(form, "done_on")) ?? today(), kind: str(form, "kind") || "maintenance", description: opt(form, "description", 500),
      cost: parseAmount(str(form, "cost")) ?? 0, vat_rate: Number(str(form, "vat_rate")) || 0, account_id: pay === "party" ? null : opt(form, "account_id", 40),
      party_id: pay === "party" ? opt(form, "party_id", 40) : null, next_due: dateOk(str(form, "next_due")),
    },
  });
  if (error) await fail(assetError(error.message));
  reval(id);
  await done("Bakım kaydedildi.");
}

export async function disposeAsset(form: FormData) {
  await need(3);
  const id = str(form, "id", 40);
  const supabase = await createClient();
  const { error } = await supabase.rpc("asset_dispose", { p_asset: id, p_date: dateOk(str(form, "date")) ?? today(), p_amount: parseAmount(str(form, "amount")) ?? 0, p_account: opt(form, "account_id", 40), p_note: opt(form, "note", 300) });
  if (error) await fail(assetError(error.message));
  reval(id);
  await done("Demirbaş elden çıkarıldı (hurda / satış).");
}
