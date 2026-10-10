"use server";
import { revalidatePath } from "next/cache";
import { done, fail } from "@/lib/flash";
import { getSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

export async function saveAssistantSettings(f: FormData) {
  const s = await getSession();
  if (s.role !== "owner") await fail("Yalnız şirket sahibi değiştirebilir.");
  const supabase = await createClient();
  const on = f.get("enabled") === "on";
  const { error } = await supabase.from("companies").update({ assistant_enabled: on, assistant_daily_limit: Math.min(500, Math.max(1, Number(f.get("limit")) || 40)) }).eq("id", s.companyId);
  if (error) await fail(error.message.includes("assistant") ? "Supabase'de 20261121000000_assistant.sql çalıştırılmalı." : error.message);
  revalidatePath("/asistan");
  await done(on ? "İK asistanı açıldı." : "İK asistanı kapatıldı.");
}
