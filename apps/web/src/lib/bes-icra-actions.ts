"use server";
import { revalidatePath } from "next/cache";
import { parseTL } from "@mb/core";
import { createClient } from "@/lib/supabase/server";
import { canManagePay, getSession } from "@/lib/session";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

export async function saveBes(_: { ok: boolean; message: string } | null, f: FormData): Promise<{ ok: boolean; message: string }> {
  const s = await getSession();
  if (!canManagePay(s.role)) return { ok: false, message: "Yetkiniz yok." };
  const employeeId = str(f, "employeeId");
  const date = str(f, "enrolled_on");
  const rate = Number(str(f, "rate").replace(",", ".") || "3") / 100;
  if (!employeeId || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, message: "Personel ve giriş tarihi zorunlu." };
  if (!(rate >= 0.03 && rate <= 0.5)) return { ok: false, message: "Oran en az %3 olmalı." };
  const supabase = await createClient();
  const { data: active } = await supabase.from("bes_enrollments").select("id").eq("employee_id", employeeId).eq("status", "active").limit(1);
  if (active?.length) return { ok: false, message: "Bu personelin aktif BES kaydı zaten var." };
  const { error } = await supabase.from("bes_enrollments").insert({
    company_id: s.companyId, employee_id: employeeId, enrolled_on: date, rate, policy_no: str(f, "policy_no") || null, note: str(f, "note") || null,
  });
  if (error) return { ok: false, message: error.message };
  revalidatePath("/bes");
  return { ok: true, message: "BES kaydı eklendi." };
}

export async function setBesStatus(f: FormData) {
  const s = await getSession();
  if (!canManagePay(s.role)) return;
  const status = str(f, "status");
  if (!["active", "opted_out", "paused", "left"].includes(status)) return;
  const supabase = await createClient();
  await supabase.from("bes_enrollments").update({ status, status_date: str(f, "status_date") || new Date().toISOString().slice(0, 10) }).eq("id", str(f, "id"));
  revalidatePath("/bes");
}

export async function saveGarnishment(_: { ok: boolean; message: string } | null, f: FormData): Promise<{ ok: boolean; message: string }> {
  const s = await getSession();
  if (!canManagePay(s.role)) return { ok: false, message: "Yetkiniz yok." };
  const kind = str(f, "kind") === "ALIMONY" ? "ALIMONY" : "ENFORCEMENT";
  const employeeId = str(f, "employeeId");
  const served = str(f, "served_at");
  if (!employeeId || !str(f, "office") || !str(f, "file_no") || !/^\d{4}-\d{2}-\d{2}$/.test(served)) return { ok: false, message: "Personel, icra dairesi, dosya no ve tebliğ tarihi zorunlu." };
  let debt: number | null = null;
  let monthly: number | null = null;
  try {
    if (kind === "ENFORCEMENT") debt = parseTL(str(f, "debt_amount"));
    else monthly = parseTL(str(f, "monthly_amount"));
  } catch {
    return { ok: false, message: kind === "ENFORCEMENT" ? "Borç tutarı okunamadı." : "Aylık nafaka tutarı okunamadı." };
  }
  const supabase = await createClient();
  const { error } = await supabase.from("garnishment_files").insert({
    company_id: s.companyId, employee_id: employeeId, kind, office: str(f, "office"), file_no: str(f, "file_no"),
    creditor: str(f, "creditor") || null, served_at: served, debt_amount: debt, monthly_amount: monthly,
    payment_iban: str(f, "payment_iban").replace(/\s/g, "").toUpperCase() || null, note: str(f, "note") || null,
  });
  if (error) return { ok: false, message: error.message };
  revalidatePath("/icra");
  return { ok: true, message: "Dosya eklendi; bir sonraki bordroda kesinti sırasına girer." };
}

export async function setGarnishmentStatus(f: FormData) {
  const s = await getSession();
  if (!canManagePay(s.role)) return;
  const status = str(f, "status");
  if (!["active", "closed", "suspended"].includes(status)) return;
  const supabase = await createClient();
  await supabase.from("garnishment_files").update({ status, closed_at: status === "closed" ? new Date().toISOString().slice(0, 10) : null }).eq("id", str(f, "id"));
  revalidatePath("/icra");
}
