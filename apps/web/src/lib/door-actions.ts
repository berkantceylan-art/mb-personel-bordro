"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { fireDoor } from "@/lib/door";

export type DoorRes = { ok: boolean; message: string };

/** Girişten sonra: mobile_punch'ın döndürdüğü kapı olayıyla röleyi tetikle */
export async function doorOpen(eventId: string): Promise<DoorRes> {
  if (!/^[0-9a-f-]{36}$/i.test(eventId)) return { ok: false, message: "Geçersiz kapı isteği" };
  return fireDoor(await createClient(), eventId);
}

/** Güvenlik / yönetici: kapıyı elle aç */
export async function doorManual(branchId: string, note?: string): Promise<DoorRes> {
  const sb = await createClient();
  const { data, error } = await sb.rpc("door_manual", { p_branch: branchId, p_note: note ?? null });
  if (error) return { ok: false, message: error.message };
  const r = await fireDoor(sb, data as string);
  revalidatePath("/guvenlik");
  revalidatePath("/yonetim/sirket");
  return r;
}
