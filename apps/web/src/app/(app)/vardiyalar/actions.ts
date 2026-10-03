"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";

const canPlan = (r: string) => ["owner", "hr", "branch_manager", "accountant"].includes(r);
const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

export async function saveShift(_: { message: string } | null, f: FormData): Promise<{ message: string }> {
  const sess = await getSession();
  if (!canPlan(sess.role)) return { message: "Yetkiniz yok." };
  const id = s(f, "id");
  const start = s(f, "start_time");
  const end = s(f, "end_time");
  if (!s(f, "name") || !s(f, "code") || !start || !end) return { message: "Ad, kısa kod, başlangıç ve bitiş zorunlu." };
  const weekdays = f.getAll("weekdays").map(Number).filter((n) => n >= 1 && n <= 7);
  const row = {
    company_id: sess.companyId,
    name: s(f, "name"),
    code: s(f, "code").toUpperCase().slice(0, 4),
    color: s(f, "color") || "#E7F1FB",
    start_time: start,
    end_time: end,
    crosses_midnight: f.get("crosses_midnight") === "on" || end <= start,
    break_minutes: Number(s(f, "break_minutes") || 0),
    break_paid: f.get("break_paid") === "on",
    late_tolerance_min: Number(s(f, "late_tolerance_min") || 0),
    early_leave_tolerance_min: Number(s(f, "early_leave_tolerance_min") || 0),
    overtime_threshold_min: Number(s(f, "overtime_threshold_min") || 0),
    weekdays: weekdays.length ? weekdays : [1, 2, 3, 4, 5, 6],
    employee_id: s(f, "employee_id") || null,
    valid_from: s(f, "valid_from") || null,
    valid_to: s(f, "valid_to") || null,
  };
  const supabase = await createClient();
  const { data, error } = id
    ? await supabase.from("shifts").update(row).eq("id", id).select("id").single()
    : await supabase.from("shifts").insert(row).select("id").single();
  if (error || !data) return { message: error?.message ?? "Kaydedilemedi" };
  if (row.employee_id) await supabase.from("employees").update({ default_shift_id: data.id }).eq("id", row.employee_id);
  revalidatePath("/vardiyalar");
  redirect("/vardiyalar");
}

export async function setShiftActive(f: FormData) {
  const sess = await getSession();
  if (!canPlan(sess.role)) return;
  const supabase = await createClient();
  await supabase.from("shifts").update({ active: f.get("active") === "true" }).eq("id", s(f, "id"));
  revalidatePath("/vardiyalar");
}

export async function assignDefaultShift(_: { message: string } | null, f: FormData): Promise<{ message: string }> {
  const sess = await getSession();
  if (!canPlan(sess.role)) return { message: "Yetkiniz yok." };
  const shiftId = s(f, "shift_id") || null;
  const depts = f.getAll("department_id").map(String).filter(Boolean);
  const supabase = await createClient();
  let q = supabase.from("employees").update({ default_shift_id: shiftId }, { count: "exact" }).eq("status", "active");
  if (depts.length) q = q.in("department_id", depts);
  const { error, count } = await q;
  if (error) return { message: error.message };
  revalidatePath("/vardiyalar");
  return { message: `${count ?? 0} personele varsayılan vardiya atandı.` };
}

/** Haftalık plan: [{employeeId, date, value}] value = shiftId | "OFF" | "" (temizle) */
export async function savePlan(changes: Array<{ employeeId: string; date: string; value: string }>): Promise<{ message: string }> {
  const sess = await getSession();
  if (!canPlan(sess.role)) return { message: "Yetkiniz yok." };
  const supabase = await createClient();
  const clear = changes.filter((c) => c.value === "");
  const upserts = changes
    .filter((c) => c.value !== "")
    .map((c) => ({
      company_id: sess.companyId,
      employee_id: c.employeeId,
      work_date: c.date,
      shift_id: c.value === "OFF" ? null : c.value,
      day_type: c.value === "OFF" ? "WEEKLY_OFF" : "WORK",
    }));
  if (upserts.length) {
    const { error } = await supabase.from("shift_assignments").upsert(upserts, { onConflict: "employee_id,work_date" });
    if (error) return { message: error.message };
  }
  for (const c of clear) {
    await supabase.from("shift_assignments").delete().eq("employee_id", c.employeeId).eq("work_date", c.date);
  }
  revalidatePath("/vardiyalar/plan");
  revalidatePath("/puantaj");
  return { message: `${changes.length} değişiklik kaydedildi.` };
}
