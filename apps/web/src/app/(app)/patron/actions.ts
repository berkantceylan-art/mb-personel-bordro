"use server";
import { revalidatePath } from "next/cache";
import { parseTL } from "@mb/core";
import { createClient } from "@/lib/supabase/server";
import { canManagePay, getSession } from "@/lib/session";
import { done, fail } from "@/lib/flash";

/** SGK tahakkuk / ödeme kaydı (ay bazında) */
export async function saveSgkPayment(f: FormData) {
  const s = await getSession();
  if (!canManagePay(s.role)) await fail("Yetkiniz yok.");
  const period = String(f.get("period") ?? "");
  if (!/^\d{4}-\d{2}$/.test(period)) await fail("Dönem geçersiz.");
  const num = (k: string) => { const v = String(f.get(k) ?? "").trim(); if (!v) return 0; try { return parseTL(v); } catch { return NaN; } };
  const accrued = num("accrued"); const paid = num("paid");
  if (Number.isNaN(accrued) || Number.isNaN(paid)) await fail("Tutar okunamadı (ör. 125.000,50).");
  const supabase = await createClient();
  const { error } = await supabase.from("sgk_payments").upsert({
    company_id: s.companyId, period, accrued, paid, paid_on: String(f.get("paid_on") ?? "") || null, due_on: String(f.get("due_on") ?? "") || null, note: String(f.get("note") ?? "").trim() || null, updated_by: s.userId, updated_at: new Date().toISOString(),
  }, { onConflict: "company_id,period" });
  if (error) await fail(error.message.includes("sgk_payments") ? "Supabase'de 20261104000000_boss.sql çalıştırılmalı." : error.message);
  revalidatePath("/patron");
  await done("SGK kaydı güncellendi.");
}
