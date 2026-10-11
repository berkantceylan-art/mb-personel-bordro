"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

/** Gösterge paneli düzeni: gizlenen kartlar ve sıra (kişiye özel) */
export async function saveDashboard(hidden: string[], order: string[]) {
  const clean = (a: string[]) => a.filter((x) => /^[a-z_]{1,30}$/.test(x)).slice(0, 40);
  const supabase = await createClient();
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) return;
  await supabase.from("user_dashboard").upsert({ user_id: u.user.id, hidden: clean(hidden), card_order: clean(order), updated_at: new Date().toISOString() });
  revalidatePath("/");
}
