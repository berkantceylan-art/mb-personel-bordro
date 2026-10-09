"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";

import { EDITABLE } from "./fields";

type R = { ok: boolean; message: string };

/** Personel özlük bilgisi değişikliği ister; İK onaylayınca uygulanır */
export async function requestProfileChange(_: R | null, f: FormData): Promise<R> {
  await getSession();
  const supabase = await createClient();
  const changes: Record<string, string> = {};
  for (const k of EDITABLE) if (f.has(k)) changes[k] = String(f.get(k) ?? "").trim();
  const { data, error } = await supabase.rpc("request_profile_change", { p_changes: changes, p_note: String(f.get("note") ?? "").trim() || null });
  if (error) return { ok: false, message: error.message.includes("request_profile_change") ? "Sunucu güncellemesi gerekli (20261101000000_profile_office_exit.sql)." : error.message };
  revalidatePath("/benim/ozluk");
  return { ok: true, message: data ? "Değişiklik talebiniz İK'ya iletildi; onaylanınca bilgileriniz güncellenir." : "Gönderildi." };
}

/** Ofis çağrısını onayla */
export async function acknowledgeOfficeCall(f: FormData) {
  await getSession();
  const supabase = await createClient();
  await supabase.from("office_calls").update({ acknowledged_at: new Date().toISOString() }).eq("id", String(f.get("id")));
  revalidatePath("/benim");
}
