"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type PostponeRes = { ok: boolean; message: string; count?: number };

/** Seçilen işlerin teslim tarihini ileri al (açık / provada / hazır işler) */
export async function jobPostpone(ids: string[], to: string, reason: string, note?: string): Promise<PostponeRes> {
  const list = (ids ?? []).filter((x) => /^[0-9a-f-]{36}$/i.test(x)).slice(0, 500);
  if (!list.length) return { ok: false, message: "İş seçilmedi." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(to)) return { ok: false, message: "Yeni tarih seçin." };
  const sb = await createClient();
  const { data, error } = await sb.rpc("job_postpone", { p_ids: list, p_to: to, p_reason: reason, p_note: note?.slice(0, 500) || null });
  if (error) return { ok: false, message: /job_postpone|schema cache/.test(error.message) ? "Supabase'de mbdental-is-erteleme.sql çalıştırılmalı." : error.message };
  revalidatePath("/isler");
  revalidatePath("/isler/ertele");
  revalidatePath("/isler/prova");
  for (const id of list.slice(0, 5)) revalidatePath(`/isler/${id}`);
  const n = Number(data ?? 0);
  return { ok: true, count: n, message: n ? `${n} iş ertelendi.` : "Ertelenecek açık iş yok (teslim edilmiş ya da tarihi zaten aynı)." };
}
