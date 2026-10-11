"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import { done, fail } from "@/lib/flash";
import { flowError } from "@/lib/flow";

export type FlowResult = {
  ok: boolean; message?: string; job?: number; job_id?: string; patient?: string | null; customer?: string | null; doctor?: string | null; due?: string | null;
  stage?: string; status?: string; holder?: string | null; role?: string; action?: string; qty?: number; options?: string[]; warnings?: string[]; minutes?: number | null;
};

/** Kutu okutma (telefon / terminal) */
export async function flowScan(code: string, employeeId: string | null, action = "auto", reason: string | null = null, target: string | null = null): Promise<FlowResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("prd_flow_scan", { p_code: code.slice(0, 200), p_employee: employeeId || null, p_action: action, p_reason: reason, p_target: target || null });
  if (error) return { ok: false, message: flowError(error.message) };
  revalidatePath("/uretim", "layout");
  const d = data as FlowResult;
  if (d.job_id) revalidatePath(`/isler/${d.job_id}`);
  return { ...d, ok: true };
}

export async function savePerson(form: FormData) {
  const s = await getSession();
  if ((s.modules.production ?? 0) < 3 && !s.logistics) await fail("Ekip düzenlemek için üretim yönetici yetkisi gerekir.");
  const supabase = await createClient();
  const emp = String(form.get("employee_id") ?? "");
  const role = String(form.get("flow_role") ?? "");
  if (role === "none") {
    const { error } = await supabase.from("prd_people").delete().eq("employee_id", emp);
    if (error) await fail(flowError(error.message));
  } else {
    const { error } = await supabase.from("prd_people").upsert({
      employee_id: emp, flow_role: ["technician", "chief", "qc", "dispatch"].includes(role) ? role : "technician",
      station_id: String(form.get("station_id") ?? "") || null, is_active: true,
    });
    if (error) await fail(flowError(error.message));
  }
  revalidatePath("/uretim", "layout");
  await done("Kaydedildi.");
}
