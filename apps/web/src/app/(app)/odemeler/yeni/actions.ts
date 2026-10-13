"use server";
import { revalidatePath } from "next/cache";
import { parseTL } from "@mb/core";
import { createClient } from "@/lib/supabase/server";
import { canManagePay, getSession } from "@/lib/session";
import { planError } from "@/lib/salary-plan";

const TYPES = ["ADVANCE", "SALARY", "BONUS", "DEDUCTION"] as const;
const CHANNELS = ["CASH", "BANK"] as const;

export interface SaveResult {
  ok: boolean;
  message: string;
  /** Yazdırılabilir (avans / maaş ödemesi) kayıtların kimlikleri */
  printIds?: string[];
}

export async function savePayment(_: SaveResult | null, formData: FormData): Promise<SaveResult> {
  const s = await getSession();
  if (!canManagePay(s.role)) return { ok: false, message: "Bu işlem için yetkiniz yok." };

  const employeeIds = formData.getAll("employeeId").map(String).filter(Boolean);
  const type = String(formData.get("type")) as (typeof TYPES)[number];
  const channelRaw = String(formData.get("channel")) as (typeof CHANNELS)[number];
  const date = String(formData.get("date") ?? "");
  const period = String(formData.get("period") ?? "");
  const note = String(formData.get("note") ?? "").trim() || null;
  const signature = String(formData.get("signature") ?? "");

  if (employeeIds.length === 0) return { ok: false, message: "En az bir personel seçin." };
  if (!TYPES.includes(type)) return { ok: false, message: "Geçersiz hareket türü." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, message: "Tarih zorunludur." };
  if (!/^\d{4}-\d{2}$/.test(period)) return { ok: false, message: "Dönem seçin." };

  let amount: number;
  try {
    amount = parseTL(String(formData.get("amount") ?? ""));
  } catch {
    return { ok: false, message: "Tutar okunamadı." };
  }
  if (amount <= 0) return { ok: false, message: "Tutar sıfırdan büyük olmalı." };

  // Prim alacak hareketidir, kesinti kanal taşımaz
  const channel = type === "BONUS" || type === "DEDUCTION" ? "NONE" : channelRaw;
  if ((type === "ADVANCE" || type === "SALARY") && !CHANNELS.includes(channelRaw)) {
    return { ok: false, message: "Ödeme kanalını seçin." };
  }

  const supabase = await createClient();

  let signaturePath: string | null = null;
  if (channel === "CASH" && signature.startsWith("data:image/png;base64,")) {
    const bytes = Buffer.from(signature.slice("data:image/png;base64,".length), "base64");
    signaturePath = `${s.companyId}/signatures/${date}-${crypto.randomUUID()}.png`;
    const { error } = await supabase.storage.from("documents").upload(signaturePath, bytes, { contentType: "image/png" });
    if (error) return { ok: false, message: `İmza kaydedilemedi: ${error.message}` };
  }

  // Kasa / banka seçildiyse: personel carisi + finans (kasa / banka bakiyesi) tek işlemde
  const accountId = String(formData.get("account_id") ?? "");
  if ((type === "ADVANCE" || type === "SALARY") && accountId) {
    const items = employeeIds.map((employee_id) => ({ employee_id, channel, amount, account_id: accountId, type, note, signature_path: signaturePath }));
    const { error } = await supabase.rpc("payroll_pay", { p: { period, date, items } });
    if (error) return { ok: false, message: planError(error.message) };
    const { data: ins } = await supabase.from("ledger_entries").select("id").in("employee_id", employeeIds).eq("period", period).eq("type", type).eq("entry_date", date).eq("account_id", accountId).is("voided_at", null).order("created_at", { ascending: false }).limit(employeeIds.length);
    revalidatePath("/");
    revalidatePath("/odemeler/yeni");
    revalidatePath(`/donemler/${period}`);
    employeeIds.forEach((id) => revalidatePath(`/personel/${id}`));
    return { ok: true, message: `${employeeIds.length} kişiye ${type === "ADVANCE" ? "avans" : "maaş ödemesi"} kaydedildi; kasa / banka bakiyesine de düştü.`, printIds: (ins ?? []).map((r) => r.id as string) };
  }

  const rows = employeeIds.map((employee_id) => ({
    company_id: s.companyId,
    employee_id,
    period,
    entry_date: date,
    type,
    channel,
    amount,
    note,
    signature_path: signaturePath,
  }));
  const { data: inserted, error } = await supabase.from("ledger_entries").insert(rows).select("id");
  if (error) return { ok: false, message: `Kaydedilemedi: ${error.message}` };

  revalidatePath("/");
  revalidatePath("/odemeler/yeni");
  employeeIds.forEach((id) => revalidatePath(`/personel/${id}`));
  const printable = type === "ADVANCE" || type === "SALARY";
  return { ok: true, message: `${rows.length} kişiye hareket kaydedildi.`, printIds: printable ? (inserted ?? []).map((r) => r.id as string) : undefined };
}
