"use server";
import { revalidatePath } from "next/cache";
import { formatTL, parseTL } from "@mb/core";
import { createClient } from "@/lib/supabase/server";
import { canManagePay, getSession } from "@/lib/session";
import { planError } from "@/lib/salary-plan";

export interface PlanResult { ok: boolean; message: string }

function touch(period: string) {
  for (const p of [`/donemler/${period}`, "/donemler", "/bordro", "/ay-sonu", "/", "/finans"]) revalidatePath(p);
}

/**
 * Seçilen personele ödeme: items = JSON [{ id, bank, cash }] (tutarlar yazıldığı gibi);
 * banka kısmı seçilen bankadan, elden kısmı seçilen kasadan; personel carisi ve finans aynı anda işlenir.
 */
export async function payPlan(_: PlanResult | null, f: FormData): Promise<PlanResult> {
  const s = await getSession();
  if (!canManagePay(s.role)) return { ok: false, message: "Yetkiniz yok." };
  const period = String(f.get("period") ?? "");
  const date = String(f.get("date") ?? "");
  const bankAcc = String(f.get("bank_account") ?? "");
  const cashAcc = String(f.get("cash_account") ?? "");
  const mode = String(f.get("mode") ?? "both");
  if (!/^\d{4}-\d{2}$/.test(period)) return { ok: false, message: "Geçersiz dönem." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, message: "Ödeme tarihini seçin." };
  let raw: Array<{ id: string; bank: string; cash: string }>;
  try { raw = JSON.parse(String(f.get("items") ?? "[]")); } catch { return { ok: false, message: "Seçim okunamadı." }; }
  const items: Array<{ employee_id: string; channel: "BANK" | "CASH"; amount: number; account_id: string }> = [];
  try {
    for (const r of raw) {
      if (mode !== "cash" && r.bank?.trim()) {
        const a = parseTL(r.bank);
        if (a > 0) items.push({ employee_id: r.id, channel: "BANK", amount: a, account_id: bankAcc });
      }
      if (mode !== "bank" && r.cash?.trim()) {
        const a = parseTL(r.cash);
        if (a > 0) items.push({ employee_id: r.id, channel: "CASH", amount: a, account_id: cashAcc });
      }
    }
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
  if (!items.length) return { ok: false, message: "Ödenecek tutar yok: personel seçin ya da tutar girin." };
  if (items.some((i) => i.channel === "BANK") && !bankAcc) return { ok: false, message: "Banka ödemesi için banka hesabını seçin." };
  if (items.some((i) => i.channel === "CASH") && !cashAcc) return { ok: false, message: "Elden ödeme için kasayı seçin." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("payroll_pay", { p: { period, date, items } });
  if (error) return { ok: false, message: planError(error.message) };
  touch(period);
  const bank = items.filter((i) => i.channel === "BANK").reduce((a, i) => a + i.amount, 0);
  const cash = items.filter((i) => i.channel === "CASH").reduce((a, i) => a + i.amount, 0);
  const people = new Set(items.map((i) => i.employee_id)).size;
  return { ok: true, message: `${people} personele ödeme işlendi (${data} kayıt)${bank ? ` · banka ${formatTL(bank)}` : ""}${cash ? ` · elden ${formatTL(cash)}` : ""}. Kasa / banka bakiyesine de düştü.` };
}

export async function undoPayment(f: FormData): Promise<void> {
  const s = await getSession();
  if (!canManagePay(s.role)) return;
  const id = String(f.get("id") ?? "");
  const period = String(f.get("period") ?? "");
  const supabase = await createClient();
  await supabase.rpc("void_ledger_entry", { p_id: id, p_reason: "Maaş planından geri alındı" });
  touch(period);
}

export async function remitPay(_: PlanResult | null, f: FormData): Promise<PlanResult> {
  const s = await getSession();
  if (!canManagePay(s.role)) return { ok: false, message: "Yetkiniz yok." };
  const period = String(f.get("period") ?? "");
  let amount: number;
  try { amount = parseTL(String(f.get("amount") ?? "")); } catch { return { ok: false, message: "Tutar okunamadı." }; }
  const supabase = await createClient();
  const { error } = await supabase.rpc("payroll_remit", {
    p: {
      period,
      kind: String(f.get("kind") ?? ""),
      ref_id: String(f.get("ref_id") ?? "") || null,
      label: String(f.get("label") ?? ""),
      amount,
      date: String(f.get("date") ?? ""),
      account_id: String(f.get("account_id") ?? ""),
    },
  });
  if (error) return { ok: false, message: planError(error.message) };
  touch(period);
  return { ok: true, message: `${formatTL(amount)} ödendi olarak işlendi.` };
}

export async function remitUndo(f: FormData): Promise<void> {
  const s = await getSession();
  if (!canManagePay(s.role)) return;
  const supabase = await createClient();
  await supabase.rpc("payroll_remit_undo", { p_id: String(f.get("id") ?? "") });
  touch(String(f.get("period") ?? ""));
}
