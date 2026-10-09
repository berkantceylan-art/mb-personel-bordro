"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import { fail } from "@/lib/flash";

const HR = ["owner", "accountant", "hr"];
const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

/** 1. adım: çıkış bilgileri (tarih, SGK kodu, neden) → personel ayrılmış olur */
export async function startExit(f: FormData) {
  const s = await getSession();
  if (!HR.includes(s.role)) await fail("Yetkiniz yok.");
  const id = str(f, "employeeId");
  const date = str(f, "termination_date");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) await fail("Çıkış tarihi zorunlu.");
  const supabase = await createClient();
  const row: Record<string, unknown> = { termination_date: date, termination_reason: str(f, "termination_reason") || null, status: "terminated" };
  const code = str(f, "termination_code") || null;
  let { error } = await supabase.from("employees").update({ ...row, termination_code: code }).eq("id", id);
  if (error?.message.includes("termination_code")) ({ error } = await supabase.from("employees").update(row).eq("id", id));
  if (error) await fail(error.message);
  revalidatePath(`/personel/${id}`);
  redirect(`/personel/${id}/cikis?adim=2`);
}

/** 4. adım: mobil hesabı ve PDKS kartını kapat */
export async function closeAccess(f: FormData) {
  const s = await getSession();
  if (!HR.includes(s.role)) await fail("Yetkiniz yok.");
  const id = str(f, "employeeId");
  const supabase = await createClient();
  const { error } = await supabase.rpc("close_employee_access", { p_employee: id });
  if (error) await fail(error.message.includes("close_employee_access") ? "Supabase'de 20261101000000_profile_office_exit.sql çalıştırılmalı." : error.message);
  revalidatePath(`/personel/${id}`);
  redirect(`/personel/${id}/cikis?adim=4&tamam=${encodeURIComponent("Mobil hesap kapatıldı, PDKS kartı kaldırıldı.")}`);
}

/** Çıkışı tamamla */
export async function finishExit(f: FormData) {
  const s = await getSession();
  if (!HR.includes(s.role)) await fail("Yetkiniz yok.");
  const id = str(f, "employeeId");
  const supabase = await createClient();
  const { error } = await supabase.from("employees").update({ exit_done_at: new Date().toISOString() }).eq("id", id);
  if (error && !error.message.includes("exit_done_at")) await fail(error.message);
  revalidatePath(`/personel/${id}`);
  redirect(`/personel/${id}?tamam=${encodeURIComponent("İşten çıkış tamamlandı.")}`);
}
