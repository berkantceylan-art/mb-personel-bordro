"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { formatTL, officialBonusGross, parseTL, periodBounds } from "@mb/core";
import { contractsAt } from "@/lib/contracts";
import { legalParams } from "@/lib/legal";
import { cumulativeBases } from "@/lib/payroll";
import { persistPayroll } from "@/lib/payroll-save";
import { planError } from "@/lib/salary-plan";
import { createClient } from "@/lib/supabase/server";
import { canManagePay, getSession } from "@/lib/session";
import { applyMissingDays } from "@/app/(app)/puantaj/actions";

export interface WizResult { ok: boolean; message: string }

const touch = () => { for (const p of ["/bordro/sihirbaz", "/bordro", "/donemler", "/ay-sonu"]) revalidatePath(p); };

/** Bu personelin puantajındaki eksik günleri (rapor dahil) hakedişe yansıtır */
export async function wizMissing(prev: WizResult | null, f: FormData): Promise<WizResult> {
  return applyMissingDays(prev, f);
}

/** Prim: elden (net, doğrudan hakediş) ya da resmi (bordroya brüt eklenir, girilen tutar personelin eline geçecek net) */
export async function wizBonus(_: WizResult | null, f: FormData): Promise<WizResult> {
  const s = await getSession();
  if (!canManagePay(s.role)) return { ok: false, message: "Yetkiniz yok." };
  const employeeId = String(f.get("employeeId") ?? "");
  const period = String(f.get("period") ?? "");
  const side = f.get("side") === "OFFICIAL" ? "OFFICIAL" : "CASH";
  const note = String(f.get("note") ?? "").trim() || null;
  let amount: number;
  try { amount = parseTL(String(f.get("amount") ?? "")); } catch { return { ok: false, message: "Tutar okunamadı · örnek: 2.500" }; }
  if (amount <= 0) return { ok: false, message: "Tutar sıfırdan büyük olmalı." };
  if (!/^\d{4}-\d{2}$/.test(period)) return { ok: false, message: "Geçersiz dönem." };
  const supabase = await createClient();
  const { end } = periodBounds(period);
  let gross: number | null = null;
  let net = amount;
  if (side === "OFFICIAL") {
    const [contracts, { data: emp }, legal] = await Promise.all([
      contractsAt(supabase, [employeeId], end),
      supabase.from("employees").select("id, hire_date").eq("id", employeeId).single(),
      legalParams(supabase, Number(period.slice(0, 4))),
    ]);
    const c = contracts.get(employeeId);
    if (!c || !emp) return { ok: false, message: "Personelin ücret kaydı yok." };
    const cum = await cumulativeBases(supabase, period, [emp], contracts);
    const a = officialBonusGross({ contract: c, month: Number(period.slice(5, 7)), cumulativeTaxBaseBefore: cum.get(employeeId) ?? 0, params: legal.params }, amount);
    gross = a.officialGross;
    net = a.officialNet;
  }
  const { error } = await supabase.from("ledger_entries").insert({
    company_id: s.companyId, employee_id: employeeId, period, entry_date: end, type: "BONUS", channel: "NONE",
    amount: net, pay_side: side, gross_amount: gross, note: `Prim (${side === "OFFICIAL" ? "resmi" : "elden"})${note ? ` · ${note}` : ""}`,
  });
  if (error) return { ok: false, message: error.message };
  touch();
  return { ok: true, message: side === "OFFICIAL" ? `Resmi prim eklendi: net ${formatTL(net)}, bordroya brüt ${formatTL(gross ?? 0)}.` : `Elden prim eklendi: ${formatTL(net)}.` };
}

/** Avans: seçilen kasa / bankadan; personel carisi + finans aynı anda */
export async function wizAdvance(_: WizResult | null, f: FormData): Promise<WizResult> {
  const s = await getSession();
  if (!canManagePay(s.role)) return { ok: false, message: "Yetkiniz yok." };
  const employeeId = String(f.get("employeeId") ?? "");
  const period = String(f.get("period") ?? "");
  const channel = f.get("channel") === "BANK" ? "BANK" : "CASH";
  let amount: number;
  try { amount = parseTL(String(f.get("amount") ?? "")); } catch { return { ok: false, message: "Tutar okunamadı · örnek: 5.000" }; }
  const supabase = await createClient();
  const { error } = await supabase.rpc("payroll_pay", {
    p: { period, date: String(f.get("date") ?? ""), items: [{ employee_id: employeeId, channel, amount, account_id: String(f.get("account_id") ?? ""), type: "ADVANCE", note: String(f.get("note") ?? "").trim() || null }] },
  });
  if (error) return { ok: false, message: planError(error.message) };
  touch();
  return { ok: true, message: `${formatTL(amount)} avans işlendi (${channel === "BANK" ? "banka" : "elden"}).` };
}

/** Prim / avans / kesinti hareketini iptal eder (bağlı kasa / banka hareketi de iptal olur) */
export async function wizVoid(f: FormData): Promise<void> {
  const s = await getSession();
  if (!canManagePay(s.role)) return;
  const supabase = await createClient();
  await supabase.rpc("void_ledger_entry", { p_id: String(f.get("id") ?? ""), p_reason: "Bordro sihirbazından geri alındı" });
  touch();
}

/** Bu personelin bordrosunu kaydet ve sıradaki personele geç */
export async function wizApprove(f: FormData): Promise<void> {
  const s = await getSession();
  if (!canManagePay(s.role)) redirect("/");
  const employeeId = String(f.get("employeeId") ?? "");
  const period = String(f.get("period") ?? "");
  const next = String(f.get("next") ?? "");
  const supabase = await createClient();
  const r = await persistPayroll(supabase, s.companyId, period, employeeId);
  touch();
  const q = new URLSearchParams({ donem: period });
  if (r.error) {
    q.set("p", employeeId);
    q.set("adim", "6");
    q.set("hata", r.error.slice(0, 200));
  } else if (next) {
    q.set("p", next);
    q.set("tamam", employeeId);
  } else {
    q.set("p", employeeId);
    q.set("adim", "6");
    q.set("bitti", "1");
  }
  redirect(`/bordro/sihirbaz?${q.toString()}`);
}
