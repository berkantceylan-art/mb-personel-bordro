"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import { ibanBank, ibanClean, ibanValid } from "@/lib/iban";

/** Personelin IBAN'ını kaydet (boş bırakılırsa silinir) */
export async function saveEmployeeIban(employeeId: string, raw: string): Promise<{ ok: boolean; message: string; iban?: string | null; bank?: string | null }> {
  const s = await getSession();
  if ((s.modules.hr ?? 0) < 2 && !["owner", "hr", "accountant"].includes(s.role)) return { ok: false, message: "Yetkiniz yok." };
  const iban = ibanClean(raw);
  if (iban && !ibanValid(iban)) return { ok: false, message: "IBAN geçersiz (TR ile başlayan 26 karakter, kontrol hanesi tutmalı)." };
  const bank = iban ? ibanBank(iban) : null;
  const sb = await createClient();
  const { data: ex } = await sb.from("employee_private").select("employee_id").eq("employee_id", employeeId).maybeSingle();
  const row = { iban: iban || null, ...(bank ? { bank_name: bank } : {}), updated_at: new Date().toISOString() };
  const { error } = ex
    ? await sb.from("employee_private").update(row).eq("employee_id", employeeId)
    : await sb.from("employee_private").insert({ employee_id: employeeId, company_id: s.companyId, ...row });
  if (error) return { ok: false, message: error.message };
  revalidatePath("/personel/ibanlar");
  return { ok: true, message: iban ? "Kaydedildi." : "IBAN silindi.", iban: iban || null, bank };
}
