"use server";
import { revalidatePath } from "next/cache";
import { done, fail } from "@/lib/flash";
import { normalizePhone } from "@/lib/recruiting";
import { createClient } from "@/lib/supabase/server";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

/** Personel arkadaşını bir ilana (ya da genel) önerir */
export async function referFriend(f: FormData) {
  const phone = normalizePhone(str(f, "phone"));
  if (!str(f, "first_name") || !phone) await fail("Ad ve geçerli bir cep telefonu yazın.");
  if (f.get("consent") !== "on") await fail("Arkadaşınızın bilgilerini paylaşmaya izni olduğunu onaylayın.");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("refer_candidate", { p_posting: str(f, "posting_id") || null, p_first: str(f, "first_name"), p_last: str(f, "last_name"), p_phone: phone, p_note: str(f, "note") || null });
  if (error) await fail(error.message.includes("refer_candidate") ? "Supabase'de 20261110000000_recruiting.sql çalıştırılmalı." : error.message);
  revalidatePath("/benim/ilanlar");
  await done(`Teşekkürler! Öneriniz İK'ya iletildi (${data}). Süreci bu sayfadan takip edebilirsiniz.`);
}
