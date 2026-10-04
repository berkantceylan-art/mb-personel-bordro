"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { canManagePay, getSession } from "@/lib/session";
import { done, fail } from "@/lib/flash";

/** Mevzuat ayarlarını kaydeder (yalnız sahip / muhasebe) */
export async function saveSettings(f: FormData) {
  const s = await getSession();
  if (!canManagePay(s.role)) await fail("Yetkiniz yok.");
  const pick = <T extends string>(k: string, allowed: readonly T[], d: T): T => {
    const v = String(f.get(k) ?? "");
    return (allowed as readonly string[]).includes(v) ? (v as T) : d;
  };
  const holiday = Number(pick("holiday_extra_rate", ["1", "2"] as const, "1"));
  const points = Number(pick("sgk_incentive_points", ["0", "2", "5"] as const, "5"));
  const row = {
    company_id: s.companyId,
    holiday_extra_rate: holiday,
    overtime_rounding: pick("overtime_rounding", ["HALF_HOUR", "EXACT"] as const, "HALF_HOUR"),
    overtime_basis: pick("overtime_basis", ["WEEKLY", "DAILY"] as const, "WEEKLY"),
    sgk_incentive_points: points,
    garnishment_after_alimony: f.get("garnishment_after_alimony") === "1",
    garnishment_after_bes: f.get("garnishment_after_bes") === "1",
    updated_by: s.userId,
    updated_at: new Date().toISOString(),
  };
  const supabase = await createClient();
  const { error } = await supabase.from("company_settings").upsert(row, { onConflict: "company_id" });
  if (error) await fail(`Kaydedilemedi: ${error.message}`);
  for (const p of ["/mevzuat", "/fazla-mesai", "/bordro", "/puantaj", "/"]) revalidatePath(p);
  await done("Mevzuat ayarları kaydedildi. Kesintisi yazılmamış bordrolar ve yeni fazla mesai önerileri bu ayarlarla hesaplanır.");
}
