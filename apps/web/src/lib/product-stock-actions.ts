"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { done, fail } from "@/lib/flash";

/** Protez ürünlerinin tümüne stok kartı aç / güncelle (Türkçe adla) */
export async function syncProductStockCards() {
  const { data, error } = await (await createClient()).rpc("stk_sync_lab_products");
  if (error) await fail(/stk_sync_lab_products|schema cache|does not exist/.test(error.message) ? "Supabase'de mbdental-protez-stok-kartlari.sql çalıştırılmalı." : /not_allowed/.test(error.message) ? "Stok yetkiniz yok." : error.message);
  const d = data as { created: number; updated: number; missing_tr: number };
  revalidatePath("/stok/urunler");
  await done(`${d.created} yeni protez stok kartı açıldı, ${d.updated} kart güncellendi.${d.missing_tr ? ` ${d.missing_tr} ürünün Türkçe adı yok: Protez ürünleri ekranından "Türkçeye çevir" ile tamamlayın, kart adı kendiliğinden güncellenir.` : ""}`);
}
