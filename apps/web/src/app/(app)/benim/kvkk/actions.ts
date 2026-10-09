"use server";
import { revalidatePath } from "next/cache";
import { done, fail } from "@/lib/flash";
import { createClient } from "@/lib/supabase/server";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const missing = (m: string) => (m.includes("kvkk") ? "Supabase'de 20261115000000_kvkk.sql çalıştırılmalı." : m);

export async function giveConsent(f: FormData) {
  const supabase = await createClient();
  const granted = str(f, "granted") === "1";
  const { error } = await supabase.rpc("kvkk_consent", { p_notice: str(f, "id"), p_granted: granted });
  if (error) await fail(missing(error.message));
  revalidatePath("/benim/kvkk");
  revalidatePath("/benim");
  await done(granted ? "Kaydedildi." : "İzniniz geri alındı.");
}

export async function sendKvkkRequest(f: FormData) {
  const supabase = await createClient();
  if (str(f, "details").length < 5) await fail("Talebinizi yazın.");
  const { error } = await supabase.rpc("kvkk_request_self", { p_type: str(f, "type") || "bilgi", p_details: str(f, "details") });
  if (error) await fail(missing(error.message));
  revalidatePath("/benim/kvkk");
  await done("Başvurunuz İK'ya iletildi; en geç 30 gün içinde yanıtlanacak.");
}
