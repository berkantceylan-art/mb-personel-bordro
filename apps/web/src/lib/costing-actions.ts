"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { done, fail } from "@/lib/flash";
import { parseMoney } from "@/lib/jobs";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const UUID = /^[0-9a-f-]{36}$/i;
const pct = (v: string) => { const n = Number(v.replace(",", ".")); return Number.isFinite(n) ? n : 0; };
function errText(m: string) {
  if (/prd_cost|prd_seed|prd_product_cost|prd_station_rate|prd_item_price|labor_rate_min|schema cache|does not exist/.test(m)) return "Supabase'de mbdental-urun-maliyeti.sql çalıştırılmalı.";
  if (/not_allowed/.test(m)) return "Bu işlem için yetkiniz yok.";
  if (/not_found/.test(m)) return "Ürün bulunamadı.";
  return m;
}
function refresh(id?: string) {
  revalidatePath("/uretim/maliyet");
  if (id) revalidatePath(`/uretim/maliyet/${id}`);
}

/** Genel oranlar: dakika ücreti, üye başına üretim genel gideri, tekrar / pazarlama / genel yönetim / finansman % */
export async function saveCostSettings(f: FormData) {
  const { error } = await (await createClient()).rpc("prd_cost_settings_save", {
    p: {
      labor_rate_min: parseMoney(str(f, "labor_rate_min")) ?? 600, overhead_per_unit: parseMoney(str(f, "overhead_per_unit")) ?? 0,
      remake_pct: pct(str(f, "remake_pct")), marketing_pct: pct(str(f, "marketing_pct")), admin_pct: pct(str(f, "admin_pct")), finance_pct: pct(str(f, "finance_pct")), note: str(f, "note"),
    },
  });
  if (error) await fail(errText(error.message));
  refresh();
  await done("Maliyet oranları kaydedildi; tüm ürünlerin maliyeti yeniden hesaplandı.");
}

/** Hazır reçete: Noritake metal-porselen (döküm) */
export async function seedNoritake(f: FormData) {
  const id = str(f, "product_id");
  if (!UUID.test(id)) await fail("Reçetenin yükleneceği ürünü seçin.");
  const { data, error } = await (await createClient()).rpc("prd_seed_pfm_noritake", { p_product: id });
  if (error) await fail(errText(error.message));
  const d = data as { items_created: number; bom_lines: number; steps: number };
  refresh(id);
  await done(`Reçete yüklendi: ${d.bom_lines} malzeme satırı (${d.items_created} yeni malzeme kartı), ${d.steps} üretim adımı. Fiyatları kendi alışlarınıza göre düzeltin.`);
}

/** Reçetedeki malzemenin birim fiyatı (stok kartı alış fiyatı) */
export async function saveItemPrice(f: FormData) {
  const price = parseMoney(str(f, "price"));
  if (price == null) await fail("Birim fiyatı yazın.");
  const { error } = await (await createClient()).rpc("prd_item_price_save", { p_item: str(f, "item_id"), p_price: price, p_currency: str(f, "currency") || "TRY" });
  if (error) await fail(errText(error.message));
  refresh(str(f, "product_id") || undefined);
  await done("Birim fiyat güncellendi.");
}

/** Reçete satırı miktarı / fire */
export async function saveBomLine(f: FormData) {
  const q = Number(str(f, "qty").replace(",", "."));
  if (!(q > 0)) await fail("Miktar sıfırdan büyük olmalı.");
  const { error } = await (await createClient()).from("stk_boms").update({ qty: q, waste_pct: Math.min(100, Math.max(0, pct(str(f, "waste_pct")))) }).eq("id", str(f, "bom_id"));
  if (error) await fail(errText(error.message));
  refresh(str(f, "product_id") || undefined);
  await done("Reçete satırı güncellendi.");
}

/** Adım süresi + istasyon dakika ücreti */
export async function saveStep(f: FormData) {
  const sb = await createClient();
  const min = Math.round(Number(str(f, "minutes").replace(",", ".")));
  if (!(min >= 0)) await fail("Süreyi dakika olarak yazın.");
  const { error } = await sb.from("prd_route_steps").update({ std_minutes: min }).eq("id", str(f, "step_id"));
  if (error) await fail(errText(error.message));
  if (str(f, "rate") !== "") {
    const { error: e2 } = await sb.rpc("prd_station_rate_save", { p_station: str(f, "station_id"), p_rate: parseMoney(str(f, "rate")) ?? 0 });
    if (e2) await fail(errText(e2.message));
  }
  refresh(str(f, "product_id") || undefined);
  await done("Adım güncellendi.");
}
