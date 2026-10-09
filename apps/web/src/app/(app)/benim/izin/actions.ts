"use server";
import { revalidatePath } from "next/cache";
import { done, fail } from "@/lib/flash";
import { createClient } from "@/lib/supabase/server";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

export async function sendPreference(f: FormData) {
  const supabase = await createClient();
  const a = str(f, "start"), b = str(f, "end") || a;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(a)) await fail("Başlangıç tarihini seçin.");
  const { error } = await supabase.rpc("submit_leave_preference", { p_start: a, p_end: b, p_note: str(f, "note") || null });
  if (error) await fail(error.message.includes("function") ? "Supabase'de 20261118000000_annual_leave.sql çalıştırılmalı." : error.message);
  revalidatePath("/benim/izin");
  await done("Tercihiniz İK'ya iletildi. İzin dönemini işveren belirler; plana alınınca bildirim alırsınız.");
}
