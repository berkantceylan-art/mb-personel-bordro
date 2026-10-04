"use server";
import { revalidatePath } from "next/cache";
import { formatTL } from "@mb/core";
import { computePayroll } from "@/lib/payroll";
import { createClient } from "@/lib/supabase/server";
import { canManagePay, getSession } from "@/lib/session";

export interface SalaryResult {
  ok: boolean;
  message: string;
}

/**
 * Dönemin kalan maaşını cariye "maaş ödemesi" olarak işler.
 * BANK: bordro netinden bankaya düşen kalan; CASH: elden kalan.
 * Aynı dönem ve kanal için ikinci kez çalıştırılırsa yalnız işlenmemiş personele yazar.
 */
export async function postSalaries(_: SalaryResult | null, f: FormData): Promise<SalaryResult> {
  const s = await getSession();
  if (!canManagePay(s.role)) return { ok: false, message: "Yetkiniz yok." };
  const period = String(f.get("period") ?? "");
  const channel = f.get("channel") === "CASH" ? "CASH" : "BANK";
  const date = String(f.get("date") ?? "");
  if (!/^\d{4}-\d{2}$/.test(period)) return { ok: false, message: "Geçersiz dönem." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, message: "Ödeme tarihini seçin." };

  const supabase = await createClient();
  const tag = `salary:${period}:${channel}`;
  const [rows, { data: already }] = await Promise.all([
    computePayroll(supabase, period),
    supabase.from("ledger_entries").select("employee_id").eq("system_tag", tag).is("voided_at", null),
  ]);
  const done = new Set((already ?? []).map((r) => r.employee_id));
  const label = channel === "BANK" ? "banka" : "elden";
  const inserts = rows
    .filter((r) => !done.has(r.employeeId))
    .map((r) => ({ r, amount: channel === "BANK" ? r.pay.bank : r.pay.cash }))
    .filter((x) => x.amount > 0)
    .map(({ r, amount }) => ({
      company_id: s.companyId,
      employee_id: r.employeeId,
      period,
      entry_date: date,
      type: "SALARY",
      channel,
      amount,
      note: `Maaş ödemesi (${label}) · ay sonu`,
      system_tag: tag,
    }));
  if (!inserts.length) return { ok: true, message: `İşlenecek ${label} ödemesi yok${done.size ? ` (${done.size} kişi daha önce işlendi)` : ""}.` };
  const { error } = await supabase.from("ledger_entries").insert(inserts);
  if (error) return { ok: false, message: `Kaydedilemedi: ${error.message}` };
  const total = inserts.reduce((a, x) => a + x.amount, 0);
  for (const p of ["/ay-sonu", "/bordro", "/donemler", "/"]) revalidatePath(p);
  return { ok: true, message: `${inserts.length} personele ${formatTL(total)} ${label} maaş ödemesi işlendi.` };
}
