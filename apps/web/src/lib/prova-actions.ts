"use server";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

/** Prova / teslim adımını tamamlandı yap (sayfa yenilenmeden) */
export async function stepDone(id: string): Promise<{ ok: boolean; message?: string }> {
  const s = await getSession();
  if (!s.logistics) return { ok: false, message: "Yetkiniz yok." };
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { ok: false, message: "Geçersiz kayıt." };
  const { error } = await (await createClient()).from("job_steps").update({ done: true }).eq("id", id);
  if (error) return { ok: false, message: error.message };
  revalidatePath("/isler/prova");
  return { ok: true };
}
