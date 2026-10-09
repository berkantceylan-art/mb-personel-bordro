"use server";
import { revalidatePath } from "next/cache";
import { parseTL } from "@mb/core";
import { createClient } from "@/lib/supabase/server";
import { canManagePay, getSession } from "@/lib/session";
import { done, fail } from "@/lib/flash";

/** SGK ve muhtasar tahakkuk / ödeme kaydı (ay bazında) */
export async function saveSgkPayment(f: FormData) {
  const s = await getSession();
  if (!canManagePay(s.role)) await fail("Yetkiniz yok.");
  const period = String(f.get("period") ?? "");
  if (!/^\d{4}-\d{2}$/.test(period)) await fail("Dönem geçersiz.");
  const num = (k: string) => { const v = String(f.get(k) ?? "").trim(); if (!v) return 0; try { return parseTL(v); } catch { return NaN; } };
  const accrued = num("accrued"); const paid = num("paid");
  const taxAccrued = num("tax_accrued"); const taxPaid = num("tax_paid");
  if ([accrued, paid, taxAccrued, taxPaid].some(Number.isNaN)) await fail("Tutar okunamadı (ör. 125.000,50).");
  const date = (k: string) => String(f.get(k) ?? "") || null;
  const supabase = await createClient();
  const row: Record<string, unknown> = {
    company_id: s.companyId, period, accrued, paid, paid_on: date("paid_on"), due_on: date("due_on"), note: String(f.get("note") ?? "").trim() || null, updated_by: s.userId, updated_at: new Date().toISOString(),
  };
  if (f.has("tax_accrued")) Object.assign(row, { tax_accrued: taxAccrued, tax_paid: taxPaid, tax_paid_on: date("tax_paid_on") });
  const { error } = await supabase.from("sgk_payments").upsert(row, { onConflict: "company_id,period" });
  if (error) await fail(error.message.includes("tax_") ? "Supabase'de 20261109000000_boss_v2.sql çalıştırılmalı." : error.message.includes("sgk_payments") ? "Supabase'de 20261104000000_boss.sql çalıştırılmalı." : error.message);
  revalidatePath("/patron");
  await done("SGK / muhtasar kaydı güncellendi.");
}

/** Maaş ödeme günü (sonraki ayın kaçında) */
export async function savePayDay(f: FormData) {
  const s = await getSession();
  if (!canManagePay(s.role)) await fail("Yetkiniz yok.");
  const day = Number(f.get("day"));
  if (!Number.isInteger(day) || day < 1 || day > 28) await fail("Gün 1–28 arasında olmalı.");
  const supabase = await createClient();
  const { error } = await supabase.from("companies").update({ salary_pay_day: day }).eq("id", s.companyId);
  if (error) await fail(error.message.includes("salary_pay_day") ? "Supabase'de 20261109000000_boss_v2.sql çalıştırılmalı." : error.message);
  revalidatePath("/patron");
  await done(`Maaş günü ayın ${day}'i olarak kaydedildi.`);
}
