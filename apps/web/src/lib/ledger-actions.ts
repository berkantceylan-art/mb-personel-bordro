"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { parseTL } from "@mb/core";
import { createClient } from "@/lib/supabase/server";
import { canManagePay, getSession } from "@/lib/session";

const TYPES = ["ACCRUAL", "BONUS", "OVERTIME", "ADVANCE", "SALARY", "BES", "GARNISHMENT", "DEDUCTION", "ADJUSTMENT"];

export async function deleteLedgerEntry(formData: FormData) {
  const s = await getSession();
  if (!canManagePay(s.role)) throw new Error("Yetkiniz yok");
  const id = String(formData.get("id"));
  const employeeId = String(formData.get("employeeId"));
  const reason = String(formData.get("reason") ?? "").trim() || "Silindi";
  const supabase = await createClient();
  const { error } = await supabase.rpc("void_ledger_entry", { p_id: id, p_reason: reason });
  if (error) throw new Error(error.message);
  revalidatePath(`/personel/${employeeId}`);
  revalidatePath("/");
  redirect(`/personel/${employeeId}`);
}

export async function correctLedgerEntry(_: { message: string } | null, formData: FormData): Promise<{ message: string }> {
  const s = await getSession();
  if (!canManagePay(s.role)) return { message: "Yetkiniz yok." };
  const id = String(formData.get("id"));
  const employeeId = String(formData.get("employeeId"));
  const type = String(formData.get("type"));
  let channel = String(formData.get("channel"));
  const date = String(formData.get("date"));
  const period = String(formData.get("period"));
  const note = String(formData.get("note") ?? "").trim() || null;
  const reason = String(formData.get("reason") ?? "").trim();
  if (!TYPES.includes(type)) return { message: "Geçersiz tür." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{4}-\d{2}$/.test(period)) return { message: "Tarih ve dönem zorunlu." };
  if (!reason) return { message: "Düzeltme gerekçesi yazın." };
  if (!["ADVANCE", "SALARY"].includes(type)) channel = "NONE";
  else if (!["BANK", "CASH"].includes(channel)) return { message: "Kanal seçin." };
  let amount: number;
  try {
    amount = parseTL(String(formData.get("amount")));
  } catch {
    return { message: "Tutar okunamadı." };
  }
  if (amount <= 0 && type !== "ADJUSTMENT") return { message: "Tutar sıfırdan büyük olmalı." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("correct_ledger_entry", {
    p_id: id,
    p_entry_date: date,
    p_type: type,
    p_channel: channel,
    p_amount: amount,
    p_period: period,
    p_note: note,
    p_reason: reason,
  });
  if (error) return { message: error.message };
  revalidatePath(`/personel/${employeeId}`);
  revalidatePath("/");
  redirect(`/personel/${employeeId}?donem=${period}`);
}
