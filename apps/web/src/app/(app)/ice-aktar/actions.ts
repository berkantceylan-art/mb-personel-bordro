"use server";
import { revalidatePath } from "next/cache";
import { tl } from "@mb/core";
import { guessPeriod, parsePayrollWorkbook } from "@/lib/excel-import";
import { createClient } from "@/lib/supabase/server";
import { getSession, todayIso } from "@/lib/session";

export interface ImportResult {
  ok: boolean;
  message: string;
  details?: string[];
}

export async function importExcel(_: ImportResult | null, formData: FormData): Promise<ImportResult> {
  const s = await getSession();
  if (s.role !== "owner" && s.role !== "accountant" && s.role !== "hr") {
    return { ok: false, message: "Bu işlem için yetkiniz yok." };
  }
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, message: "Excel dosyası seçin." };

  let parsed;
  try {
    parsed = await parsePayrollWorkbook(await file.arrayBuffer());
  } catch (e) {
    return { ok: false, message: `Dosya okunamadı: ${(e as Error).message}` };
  }

  const year = Number(formData.get("year") ?? new Date().getFullYear());
  const period = String(formData.get("period") || guessPeriod(parsed.sheetName, year) || "");
  if (!/^\d{4}-\d{2}$/.test(period)) return { ok: false, message: "Dönem belirlenemedi; formdan seçin." };
  const withAccrual = formData.get("accrual") === "on";
  const withPayments = formData.get("payments") === "on";
  const paymentDate = String(formData.get("paymentDate") || todayIso());

  const supabase = await createClient();
  const details: string[] = [];

  const { data: branch } = await supabase.from("branches").select("id").eq("company_id", s.companyId).order("created_at").limit(1).single();
  if (!branch) return { ok: false, message: "Önce bir şube tanımlayın." };

  // Bölümler
  const deptNames = [...new Set(parsed.rows.map((r) => r.department))];
  await supabase.from("departments").upsert(
    deptNames.map((name) => ({ company_id: s.companyId, name })),
    { onConflict: "company_id,name", ignoreDuplicates: true },
  );
  const { data: depts } = await supabase.from("departments").select("id, name").eq("company_id", s.companyId);
  const deptId = new Map((depts ?? []).map((d) => [d.name, d.id]));

  // Var olan personel (ad + soyad ile eşleşir)
  const { data: existing } = await supabase.from("employees").select("id, first_name, last_name").eq("company_id", s.companyId);
  const key = (f: string, l: string) => `${f} ${l}`.toLocaleUpperCase("tr");
  const empId = new Map((existing ?? []).map((e) => [key(e.first_name, e.last_name), e.id]));

  let created = 0;
  let contracts = 0;
  let ledgerCount = 0;
  const ledgerRows: Record<string, unknown>[] = [];

  for (const r of parsed.rows) {
    let id = empId.get(key(r.firstName, r.lastName));
    if (!id) {
      const { data, error } = await supabase
        .from("employees")
        .insert({
          company_id: s.companyId,
          branch_id: branch.id,
          department_id: deptId.get(r.department) ?? null,
          first_name: r.firstName,
          last_name: r.lastName || "-",
          hire_date: r.hireDate ?? `${period}-01`,
        })
        .select("id")
        .single();
      if (error || !data) {
        details.push(`Satır ${r.rowNo} (${r.firstName} ${r.lastName}): ${error?.message}`);
        continue;
      }
      id = data.id as string;
      empId.set(key(r.firstName, r.lastName), id);
      created++;

      if (r.monthlyTotal > 0) {
        const { error: cErr } = await supabase.from("pay_contracts").insert({
          company_id: s.companyId,
          employee_id: id,
          valid_from: r.hireDate ?? `${period}-01`,
          total_net: tl(r.monthlyTotal),
          insurance_type: "MIN_WAGE",
        });
        if (!cErr) contracts++;
      }
    }

    const base = { company_id: s.companyId, employee_id: id, period, note: "Excel aktarımı" };
    if (withAccrual && r.accrual > 0) {
      ledgerRows.push({ ...base, entry_date: `${period}-01`, type: "ACCRUAL", channel: "NONE", amount: tl(r.accrual) });
    }
    if (withPayments) {
      const add = (type: string, channel: string, amounts: number[]) =>
        amounts.filter((a) => a > 0).forEach((a) => ledgerRows.push({ ...base, entry_date: paymentDate, type, channel, amount: tl(a) }));
      add("ADVANCE", "CASH", r.cashAdvances);
      add("ADVANCE", "BANK", r.bankAdvances);
      add("SALARY", "BANK", r.bankPayments);
      add("SALARY", "CASH", r.cashPayments);
      add("DEDUCTION", "NONE", [r.deduction]);
      add("BES", "NONE", [r.bes]);
      add("GARNISHMENT", "NONE", [r.garnishment]);
    }
  }

  if (ledgerRows.length) {
    const { error } = await supabase.from("ledger_entries").insert(ledgerRows);
    if (error) details.push(`Cari hareketler: ${error.message}`);
    else ledgerCount = ledgerRows.length;
  }

  revalidatePath("/");
  revalidatePath("/personel");
  return {
    ok: details.length === 0,
    message: `${parsed.rows.length} satır okundu · ${created} yeni personel · ${contracts} ücret sözleşmesi · ${ledgerCount} cari hareket (${period}).`,
    details,
  };
}
