"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import { done, fail } from "@/lib/flash";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const CHIEF = ["owner", "hr", "branch_manager"];
const ADMIN = ["owner", "hr"];

/** Şef: bölümü için mesai yemeği talebi */
export async function requestMeal(f: FormData) {
  const s = await getSession();
  if (!CHIEF.includes(s.role)) await fail("Yetkiniz yok.");
  const onDate = str(f, "on_date");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(onDate)) await fail("Tarih seçin.");
  const ids = f.getAll("employee_id").map(String).filter(Boolean);
  const count = Number(str(f, "head_count")) || ids.length;
  if (count <= 0) await fail("Kişi sayısı girin ya da personel seçin.");
  const supabase = await createClient();
  const { error } = await supabase.from("meal_requests").insert({
    company_id: s.companyId, department_id: str(f, "department_id") || null, on_date: onDate, head_count: count, employee_ids: ids, note: str(f, "note") || null,
    ...(ADMIN.includes(s.role) && f.get("approve") === "on" ? { status: "approved", decided_by: s.userId, decided_at: new Date().toISOString() } : {}),
  });
  if (error) await fail(error.message.includes("meal_requests") ? "Supabase'de 20261102000000_chief_meal.sql çalıştırılmalı." : error.message);
  revalidatePath("/yemek");
  await done(`${onDate.split("-").reverse().join(".")} için ${count} kişilik mesai yemeği talebi gönderildi.`);
}

export async function decideMeal(status: "approved" | "rejected", f: FormData) {
  const s = await getSession();
  if (!ADMIN.includes(s.role)) await fail("Onay yetkiniz yok.");
  const supabase = await createClient();
  const { error } = await supabase.from("meal_requests").update({ status, decision_note: str(f, "note") || null, decided_by: s.userId, decided_at: new Date().toISOString() }).eq("id", str(f, "id")).eq("status", "pending");
  if (error) await fail(error.message);
  revalidatePath("/yemek");
  await done(status === "approved" ? "Yemek talebi onaylandı." : "Yemek talebi reddedildi.");
}

export async function deleteMeal(f: FormData) {
  await getSession();
  const supabase = await createClient();
  const { error } = await supabase.from("meal_requests").delete().eq("id", str(f, "id"));
  if (error) await fail(error.message);
  revalidatePath("/yemek");
}
