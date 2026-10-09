"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import { done, fail } from "@/lib/flash";

import { CATS } from "./cats";

export async function savePrefs(f: FormData) {
  const s = await getSession();
  const supabase = await createClient();
  const muted = CATS.map(([k]) => k).filter((k) => f.get(`cat_${k}`) !== "on");
  const { error } = await supabase.from("notification_prefs").upsert({ user_id: s.userId, push: f.get("push") === "on", muted, big_text: f.get("big_text") === "on", updated_at: new Date().toISOString() });
  if (error) await fail(error.message.includes("notification_prefs") ? "Sunucu güncellemesi gerekli (20261107000000_prefs_security.sql)." : error.message);
  revalidatePath("/", "layout");
  await done("Ayarlar kaydedildi.");
}
