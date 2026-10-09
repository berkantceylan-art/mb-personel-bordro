"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import { fail } from "@/lib/flash";

/** Kayıt sihirbazını tamamla: personel sayfasına dön */
export async function finishOnboarding(f: FormData) {
  const s = await getSession();
  if (!["owner", "accountant", "hr"].includes(s.role)) await fail("Yetkiniz yok");
  const id = String(f.get("employeeId"));
  const supabase = await createClient();
  const { error } = await supabase.from("employees").update({ onboarding_done_at: new Date().toISOString() }).eq("id", id);
  if (error && !error.message.includes("onboarding_done_at")) await fail(error.message);
  revalidatePath(`/personel/${id}`);
  redirect(`/personel/${id}?tamam=${encodeURIComponent("Personel kaydı tamamlandı. Eksik belgeleri özlük dosyasından her zaman yükleyebilirsiniz.")}`);
}

/** Sihirbazı yeniden aç */
export async function reopenOnboarding(f: FormData) {
  const s = await getSession();
  if (!["owner", "accountant", "hr"].includes(s.role)) await fail("Yetkiniz yok");
  const id = String(f.get("employeeId"));
  const supabase = await createClient();
  await supabase.from("employees").update({ onboarding_done_at: null }).eq("id", id);
  redirect(`/personel/${id}/kayit?adim=2`);
}
