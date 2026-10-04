"use server";
import { revalidatePath } from "next/cache";
import { accrualForPeriod, periodBounds } from "@mb/core";
import { createClient } from "@/lib/supabase/server";
import { canManagePay, getSession } from "@/lib/session";
import { done, fail } from "@/lib/flash";

export interface PeriodResult {
  ok: boolean;
  message: string;
}

/** Dönemi açar ve aktif personele hakediş yazar. Hakedişi olanları atlar (tekrar çalıştırılabilir). */
export async function createPeriod(_: PeriodResult | null, formData: FormData): Promise<PeriodResult> {
  const s = await getSession();
  if (!canManagePay(s.role)) return { ok: false, message: "Yetkiniz yok." };
  const period = String(formData.get("period") ?? "");
  if (!/^\d{4}-\d{2}$/.test(period)) return { ok: false, message: "Geçersiz dönem." };
  const { start, end } = periodBounds(period);
  const supabase = await createClient();

  const { data: existingPeriod } = await supabase.from("payroll_periods").select("status").eq("period", period).maybeSingle();
  if (existingPeriod?.status === "closed") return { ok: false, message: "Bu dönem kapalı." };

  const { data: emps, error: eErr } = await supabase
    .from("employees")
    .select("id, hire_date, termination_date")
    .lte("hire_date", end)
    .or(`termination_date.is.null,termination_date.gte.${start}`);
  if (eErr) return { ok: false, message: eErr.message };
  const ids = (emps ?? []).map((e) => e.id);
  if (ids.length === 0) return { ok: false, message: "Bu döneme ait personel yok." };

  const [{ data: contracts }, { data: existing }] = await Promise.all([
    supabase.from("pay_contracts").select("employee_id, valid_from, valid_to, total_net").in("employee_id", ids).lte("valid_from", end),
    supabase.from("ledger_entries").select("employee_id").eq("period", period).eq("type", "ACCRUAL").is("voided_at", null),
  ]);
  const has = new Set((existing ?? []).map((r) => r.employee_id));
  const byEmp = new Map<string, Array<{ validFrom: string; validTo: string | null; totalNet: number }>>();
  for (const c of contracts ?? []) {
    const l = byEmp.get(c.employee_id) ?? [];
    l.push({ validFrom: c.valid_from, validTo: c.valid_to, totalNet: Number(c.total_net) });
    byEmp.set(c.employee_id, l);
  }

  const rows: Record<string, unknown>[] = [];
  let noContract = 0;
  for (const e of emps ?? []) {
    if (has.has(e.id)) continue;
    const cs = byEmp.get(e.id);
    if (!cs?.length) {
      noContract++;
      continue;
    }
    const r = accrualForPeriod({ period, contracts: cs, hireDate: e.hire_date, terminationDate: e.termination_date });
    if (r.accrual <= 0) continue;
    rows.push({
      company_id: s.companyId,
      employee_id: e.id,
      period,
      entry_date: start,
      type: "ACCRUAL",
      channel: "NONE",
      amount: r.accrual,
      note: r.days === 30 && r.segments.length === 1 ? "Dönem hakedişi" : `Dönem hakedişi (${r.days} gün${r.segments.length > 1 ? ", ay içi ücret değişikliği" : ""})`,
    });
  }

  if (rows.length) {
    const { error } = await supabase.from("ledger_entries").insert(rows);
    if (error) return { ok: false, message: `Hakedişler yazılamadı: ${error.message}` };
  }

  const { data: totals } = await supabase.from("ledger_entries").select("amount").eq("period", period).eq("type", "ACCRUAL").is("voided_at", null);
  const total = (totals ?? []).reduce((a, r) => a + Number(r.amount), 0);
  await supabase.from("payroll_periods").upsert(
    { company_id: s.companyId, period, employee_count: totals?.length ?? 0, total_accrual: total },
    { onConflict: "company_id,period" },
  );

  revalidatePath("/donemler");
  revalidatePath("/");
  const skipped = has.size ? ` ${has.size} kişinin hakedişi zaten vardı.` : "";
  const missing = noContract ? ` ${noContract} kişinin ücret kaydı yok, atlandı.` : "";
  return { ok: true, message: `${rows.length} personele hakediş yazıldı.${skipped}${missing}` };
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
  revalidatePath("/");
  revalidatePath("/bordro");
  if (close) {
    const r = data as { carried: number; next: string };
    await done(`${period} kapatıldı. ${r.carried} personelin kalan bakiyesi ${r.next} dönemine devredildi.`);
  }
  await done(`${period} yeniden açıldı; devir hareketleri geri alındı.`);
}
