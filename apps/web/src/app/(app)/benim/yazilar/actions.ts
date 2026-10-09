"use server";
import { revalidatePath } from "next/cache";
import { done, fail } from "@/lib/flash";
import { createClient } from "@/lib/supabase/server";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const missing = (m: string) => (m.includes("function") || m.includes("schema cache") ? "Supabase'de 20261117000000_labor_law.sql çalıştırılmalı." : m);

export async function sendDefense(f: FormData) {
  const supabase = await createClient();
  if (str(f, "text").length < 3) await fail("Savunmanızı yazın.");
  const { error } = await supabase.rpc("submit_defense", { p_case: str(f, "id"), p_text: str(f, "text") });
  if (error) await fail(missing(error.message));
  revalidatePath("/benim/yazilar");
  await done("Savunmanız İK'ya iletildi.");
}

export async function answerChange(f: FormData) {
  const supabase = await createClient();
  const accept = str(f, "accept") === "1";
  const { error } = await supabase.rpc("respond_change", { p_change: str(f, "id"), p_accept: accept, p_note: str(f, "note") || null });
  if (error) await fail(missing(error.message));
  revalidatePath("/benim/yazilar");
  await done(accept ? "Kabulünüz kaydedildi." : "Kabul etmediğiniz kaydedildi.");
}
