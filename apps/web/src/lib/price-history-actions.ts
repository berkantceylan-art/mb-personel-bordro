"use server";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

/** Hekimin (ya da tüm hekimlerin) geçmiş işlerinden ürün başına son fiyatı özel fiyat listesine yazar */
export async function pricesFromHistory(customerId: string | null, overwrite: boolean): Promise<{ ok: boolean; message: string }> {
  const s = await getSession();
  if (!s.logistics) return { ok: false, message: "Yetkiniz yok." };
  const sb = await createClient();
  const { data, error } = await sb.rpc("lab_prices_from_history", { p_customer: customerId, p_overwrite: overwrite });
  if (error) return { ok: false, message: /lab_prices_from_history|schema cache/.test(error.message) ? "Supabase'de mbdental-hekim-fiyat.sql çalıştırılmalı." : /not_allowed/.test(error.message) ? "Yetkiniz yok." : error.message };
  const r = data as { added: number; updated: number; customers: number };
  revalidatePath("/isler/hekimler", "layout");
  return { ok: true, message: `${r.added} yeni fiyat eklendi${r.updated ? `, ${r.updated} fiyat güncellendi` : ""}${customerId ? "" : ` · ${r.customers} hekim`}.` };
}
