"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { canManagePay, getSession } from "@/lib/session";
import { computePayroll } from "@/lib/payroll";

export interface RunResult {
  ok: boolean;
  message: string;
}

export async function savePayroll(_: RunResult | null, f: FormData): Promise<RunResult> {
  const s = await getSession();
  if (!canManagePay(s.role)) return { ok: false, message: "Yetkiniz yok." };
  const period = String(f.get("period"));
  const supabase = await createClient();
  const rows = await computePayroll(supabase, period);
  const posted = rows.filter((r) => r.saved?.posted);
  const toSave = rows.filter((r) => !r.saved?.posted);
  if (toSave.length) {
    const { error } = await supabase.from("payroll_lines").upsert(
      toSave.map((r) => {
        const b = r.result.breakdown;
        return {
          company_id: s.companyId,
          employee_id: r.employeeId,
          period,
          days: r.result.days,
          official_gross: b.gross,
          sgk_employee: b.sgkEmployee,
          unemployment_employee: b.unemploymentEmployee,
          income_tax: b.incomeTax,
          stamp_tax: b.stampTax,
          official_net: b.net,
          bes: b.bes,
          garnishment: r.result.garnishmentTotal,
          net_to_bank: r.result.netToBank,
          employer_cost: b.employerCost,
          cumulative_tax_base_after: b.cumulativeTaxBaseAfter,
          data: { result: r.result, cumulativeBefore: r.cumulativeBefore, cumulativeEstimated: r.cumulativeEstimated, insurance: r.insurance, totalNet: r.totalNet },
          posted: false,
        };
      }),
      { onConflict: "employee_id,period" },
    );
    if (error) return { ok: false, message: error.message };
  }
  revalidatePath("/bordro");
  return { ok: true, message: `${toSave.length} bordro kaydedildi.${posted.length ? ` ${posted.length} bordronun kesintileri cariye yazıldığı için değiştirilmedi.` : ""}` };
}

/** BES ve icra/nafaka kesintilerini dönem cari hesabına yazar */
export async function postDeductions(_: RunResult | null, f: FormData): Promise<RunResult> {
  const s = await getSession();
  if (!canManagePay(s.role)) return { ok: false, message: "Yetkiniz yok." };
  const period = String(f.get("period"));
  const supabase = await createClient();
  const { data: lines } = await supabase.from("payroll_lines").select("id, employee_id, bes, data").eq("period", period).eq("posted", false);
  if (!lines?.length) return { ok: false, message: "Önce bordroyu hesaplayıp kaydedin (veya kesintiler zaten yazılmış)." };
  const entryDate = `${period}-${period.endsWith("-02") ? "28" : "30"}`;
  let count = 0;
  for (const l of lines) {
    const result = (l.data as { result: { garnishments: Array<{ fileId: string; amount: number }> } }).result;
    if (Number(l.bes) > 0) {
      await supabase.from("ledger_entries").insert({
        company_id: s.companyId, employee_id: l.employee_id, period, entry_date: entryDate,
        type: "BES", channel: "NONE", amount: Number(l.bes), pay_side: "OFFICIAL", note: "BES otomatik katılım kesintisi",
      });
      count++;
    }
    for (const g of result.garnishments ?? []) {
      const { data: file } = await supabase.from("garnishment_files").select("office, file_no, kind").eq("id", g.fileId).single();
      const { data: entry } = await supabase
        .from("ledger_entries")
        .insert({
          company_id: s.companyId, employee_id: l.employee_id, period, entry_date: entryDate,
          type: "GARNISHMENT", channel: "NONE", amount: g.amount, pay_side: "OFFICIAL",
          note: `${file?.kind === "ALIMONY" ? "Nafaka" : "İcra"} · ${file?.office ?? ""} ${file?.file_no ?? ""}`.trim(),
        })
        .select("id")
        .single();
      await supabase.from("garnishment_deductions").upsert(
        { company_id: s.companyId, file_id: g.fileId, employee_id: l.employee_id, period, amount: g.amount, ledger_entry_id: entry?.id ?? null },
        { onConflict: "file_id,period" },
      );
      count++;
    }
    await supabase.from("payroll_lines").update({ posted: true }).eq("id", l.id);
  }
  revalidatePath("/bordro");
  revalidatePath("/icra");
  return { ok: true, message: `${lines.length} bordro için ${count} kesinti cari hesaba yazıldı.` };
}

export async function unpostDeductions(f: FormData) {
  const s = await getSession();
  if (!canManagePay(s.role)) return;
  const period = String(f.get("period"));
  const supabase = await createClient();
  const { data: entries } = await supabase
    .from("ledger_entries")
    .select("id")
    .eq("period", period)
    .in("type", ["BES", "GARNISHMENT"])
    .is("voided_at", null);
  for (const e of entries ?? []) await supabase.rpc("void_ledger_entry", { p_id: e.id, p_reason: "Bordro kesintileri geri alındı" });
  await supabase.from("garnishment_deductions").delete().eq("period", period);
  await supabase.from("payroll_lines").update({ posted: false }).eq("period", period);
  revalidatePath("/bordro");
  revalidatePath("/icra");
}
