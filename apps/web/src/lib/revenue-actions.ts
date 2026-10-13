"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { done, fail } from "@/lib/flash";

/** Müşteri ciroları ekranını bir kullanıcıya aç / kapat (yalnız şirket sahibi) */
export async function setRevenueViewer(f: FormData) {
  const supabase = await createClient();
  const on = String(f.get("on")) === "1";
  const { error } = await supabase.rpc("rev_viewer_set", { p_user: String(f.get("user") ?? ""), p_on: on });
  if (error) await fail(/not_owner/.test(error.message) ? "Bu ayarı yalnız şirket sahibi değiştirebilir." : error.message);
  revalidatePath("/ciro");
  await done(on ? "Ciro ekranı bu kullanıcıya açıldı." : "Ciro ekranı erişimi kaldırıldı.");
}
