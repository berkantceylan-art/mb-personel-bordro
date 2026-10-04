"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { canManagePay, getSession } from "@/lib/session";
import { done, fail } from "@/lib/flash";
import { openPeriod } from "@/lib/periods";

export interface PeriodResult {
  ok: boolean;
  message: string;
}

/** Dönemi açar ve aktif personele hakediş yazar. Hakedişi olanları atlar (tekrar çalıştırılabilir). */
export async function createPeriod(_: PeriodResult | null, formData: FormData): Promise<PeriodResult> {
  const s = await getSession();
  if (!canManagePay(s.role)) return { ok: false, message: "Yetkiniz yok." };
  const period = String(formData.get("period") ?? "");
  const supabase = await createClient();
  const r = await openPeriod(supabase, s.companyId, period);
  revalidatePath("/donemler");
  revalidatePath("/ay-sonu");
  revalidatePath("/");
  return r;
}

/** Kapat: kalan bakiyeler sonraki aya devredilir, dönem kilitlenir. Aç: devirler geri alınır. */
export async function setPeriodStatus(formData: FormData) {
  const s = await getSession();
  if (!canManagePay(s.role)) await fail("Yetkiniz yok.");
  const period = String(formData.get("period"));
  const close = formData.get("status") === "closed";
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(close ? "close_period" : "reopen_period", { p_period: period });
  if (error) await fail(error.message);
  revalidatePath("/donemler");
  revalidatePath("/ay-sonu");
  revalidatePath("/");
  revalidatePath("/bordro");
  if (close) {
    const r = data as { carried: number; next: string };
    await done(`${period} kapatıldı. ${r.carried} personelin kalan bakiyesi ${r.next} dönemine devredildi.`);
  }
  await done(`${period} yeniden açıldı; devir hareketleri geri alındı.`);
}
