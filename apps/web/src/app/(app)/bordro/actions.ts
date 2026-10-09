"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { canManagePay, getSession } from "@/lib/session";
import { computePayroll } from "@/lib/payroll";
import { done, fail } from "@/lib/flash";

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
  revalidatePath("/ay-sonu");
  return { ok: true, message: `${toSave.length} bordro kaydedildi.${posted.length ? ` ${posted.length} bordronun kesintileri cariye yazıldığı için değiştirilmedi.` : ""}` };
}

/** BES ve icra/nafaka kesintilerini dönem cari hesabına yazar — tek işlem (ya hepsi ya hiçbiri) */
export async function postDeductions(_: RunResult | null, f: FormData): Promise<RunResult> {
  const s = await getSession();
  if (!canManagePay(s.role)) return { ok: false, message: "Yetkiniz yok." };
  const period = String(f.get("period"));
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("post_payroll_deductions", { p_period: period });
  if (error) return { ok: false, message: error.message };
  const r = data as { lines: number; deductions: number };
  revalidatePath("/bordro");
  revalidatePath("/ay-sonu");
  revalidatePath("/icra");
  if (!r.lines) return { ok: false, message: "Yazılacak kesinti yok: önce bordroyu hesaplayıp kaydedin (veya kesintiler zaten yazılmış)." };
  return { ok: true, message: `${r.lines} bordro için ${r.deductions} kesinti cari hesaba yazıldı.` };
}

export async function unpostDeductions(_: RunResult | null, f: FormData): Promise<RunResult> {
  const s = await getSession();
  if (!canManagePay(s.role)) return { ok: false, message: "Yetkiniz yok." };
  const period = String(f.get("period"));
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("unpost_payroll_deductions", { p_period: period });
  if (error) return { ok: false, message: error.message };
  revalidatePath("/bordro");
  revalidatePath("/ay-sonu");
  revalidatePath("/icra");
  return { ok: true, message: `${(data as { voided: number }).voided} kesinti geri alındı.` };
}

/**
 * İmzalı bordroları yükle: birden çok dosya; dosya adında PDKS no ya da ad soyad geçen personele bağlanır.
 * Tek personel için employeeId verilirse dosya doğrudan ona bağlanır.
 */
export async function uploadSignedPayslips(f: FormData) {
  const s = await getSession();
  if (!canManagePay(s.role) && s.role !== "hr") await fail("Yetkiniz yok");
  const period = String(f.get("period") ?? "");
  if (!/^\d{4}-\d{2}$/.test(period)) await fail("Dönem geçersiz");
  const employeeId = String(f.get("employeeId") ?? "") || null;
  const files = f.getAll("files").filter((x): x is File => x instanceof File && x.size > 0);
  if (!files.length) await fail("Dosya seçilmedi");
  const supabase = await createClient();
  const [{ data: type }, { data: emps }] = await Promise.all([
    supabase.from("document_types").select("id").eq("name", "İmzalı bordro").is("company_id", null).maybeSingle(),
    supabase.from("employees").select("id, first_name, last_name, card_no"),
  ]);
  if (!type) await fail("'İmzalı bordro' belge türü yok: Supabase'de 20261031000000_mobile_self_service.sql çalıştırın.");
  const nrm = (t: string) => t.toLocaleLowerCase("tr").replace(/[çğıöşüâ]/g, (c) => ({ ç: "c", ğ: "g", ı: "i", ö: "o", ş: "s", ü: "u", â: "a" })[c] ?? c).replace(/[^a-z0-9]/g, "");
  const byCard = new Map((emps ?? []).filter((e) => e.card_no).map((e) => [String(e.card_no).replace(/^0+/, ""), e.id]));
  const byName = (emps ?? []).map((e) => ({ id: e.id, k: nrm(`${e.first_name}${e.last_name === "-" ? "" : e.last_name}`) }));
  const ok: string[] = []; const bad: string[] = [];
  for (const file of files) {
    let target = employeeId;
    if (!target) {
      const base = file.name.replace(/\.[^.]+$/, "");
      const num = base.match(/\d{4,}/)?.[0]?.replace(/^0+/, "");
      target = (num && byCard.get(num)) ?? byName.find((e) => nrm(base).includes(e.k))?.id ?? null;
    }
    if (!target) { bad.push(file.name); continue; }
    if (file.size > 10 * 1024 * 1024) { bad.push(`${file.name} (10 MB üstü)`); continue; }
    const ext = (file.name.split(".").pop() ?? "pdf").toLowerCase().replace(/[^a-z0-9]/g, "");
    const path = `${s.companyId}/employees/${target}/bordro-${period}-${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from("documents").upload(path, file, { contentType: file.type || undefined });
    if (error) { bad.push(`${file.name} (${error.message})`); continue; }
    // Aynı dönem için eskisi silinir
    const { data: old } = await supabase.from("employee_documents").select("id, file_path").eq("employee_id", target).eq("document_type_id", type!.id).eq("period", period);
    for (const o of old ?? []) { await supabase.storage.from("documents").remove([o.file_path]); await supabase.from("employee_documents").delete().eq("id", o.id); }
    const { error: e2 } = await supabase.from("employee_documents").insert({ company_id: s.companyId, employee_id: target, document_type_id: type!.id, file_path: path, file_name: file.name, period });
    if (e2) { bad.push(`${file.name} (${e2.message})`); continue; }
    ok.push(file.name);
  }
  revalidatePath("/bordro");
  const msg = `${ok.length} imzalı bordro yüklendi.${bad.length ? ` Eşleşmeyen/başarısız: ${bad.join(", ")}` : ""}`;
  if (!ok.length) await fail(msg);
  await done(msg);
}
