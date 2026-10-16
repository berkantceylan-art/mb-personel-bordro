"use server";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { translateMissing } from "@/lib/product-tr";

/** Türkçe adı olmayan protez / ürünlerden bir parti (60) çevirir; ekran kalan bitene kadar tekrar çağırır */
export async function translateProductBatch(): Promise<{ ok: boolean; done?: number; left?: number; message?: string }> {
  const s = await getSession();
  if (!s.logistics) return { ok: false, message: "Yetkiniz yok." };
  try {
    const r = await translateMissing(await createClient(), 60, true);
    revalidatePath("/isler/urunler");
    return { ok: true, ...r };
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    return { ok: false, message: /name_tr|lab_products_set_tr|schema cache/.test(m) ? "Önce mbdental-dentalsis-duzenleme.sql dosyasını Supabase'de çalıştırın." : m };
  }
}
