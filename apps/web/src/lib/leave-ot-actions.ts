"use server";
import { revalidatePath } from "next/cache";
import { countLeaveDays, overtimePay, roundKurus } from "@mb/core";
import { createClient } from "@/lib/supabase/server";
import { canManagePay, getSession } from "@/lib/session";

const canHr = (r: string) => ["owner", "accountant", "hr", "branch_manager"].includes(r);

export async function createLeave(_: { ok: boolean; message: string } | null, f: FormData): Promise<{ ok: boolean; message: string }> {
  const s = await getSession();
  if (!canHr(s.role)) return { ok: false, message: "Yetkiniz yok." };
  const employeeId = String(f.get("employeeId") ?? "");
  const typeId = String(f.get("typeId") ?? "");
  const start = String(f.get("start") ?? "");
  const end = String(f.get("end") ?? "") || start;
  const halfDay = f.get("half_day") === "on";
  if (!employeeId || !typeId || !/^\d{4}-\d{2}-\d{2}$/.test(start)) return { ok: false, message: "Personel, izin türü ve tarih zorunlu." };
  if (end < start) return { ok: false, message: "Bitiş tarihi başlangıçtan önce olamaz." };
  const supabase = await createClient();
  const [{ data: type }, { data: hol }] = await Promise.all([
    supabase.from("leave_types").select("code, is_sick_leave").eq("id", typeId).single(),
    supabase.from("public_holidays").select("date").gte("date", start).lte("date", end).eq("half_day", false),
  ]);
  // Rapor ve doğum izni takvim günüyle, diğerleri iş günüyle sayılır
  const calendar = type?.is_sick_leave || type?.code === "DOGUM";
  const days = calendar
    ? (Date.parse(end) - Date.parse(start)) / 86_400_000 + 1
    : countLeaveDays(start, end, { holidays: new Set((hol ?? []).map((h) => h.date as string)), halfDay });
  if (days <= 0) return { ok: false, message: "Seçilen aralıkta izin günü yok (pazar / resmi tatil)." };

  const { data: overlap } = await supabase
    .from("leave_requests")
    .select("id")
    .eq("employee_id", employeeId)
    .in("status", ["pending", "approved"])
    .lte("start_date", end)
    .gte("end_date", start)
    .limit(1);
  if (overlap?.length) return { ok: false, message: "Bu tarihlerde personelin başka bir izni var." };

  const approve = f.get("approve") === "on";
  const { error } = await supabase.from("leave_requests").insert({
    company_id: s.companyId,
    employee_id: employeeId,
    leave_type_id: typeId,
    start_date: start,
    end_date: end,
    days,
    half_day: halfDay,
    note: String(f.get("note") ?? "").trim() || null,
    status: approve ? "approved" : "pending",
    decided_by: approve ? s.userId : null,
    decided_at: approve ? new Date().toISOString() : null,
  });
  if (error) return { ok: false, message: error.message };
  revalidatePath("/izin");
  revalidatePath("/puantaj");
  return { ok: true, message: `${days} günlük izin ${approve ? "onaylandı" : "onaya gönderildi"}.` };
}

export async function decideLeave(f: FormData) {
  const s = await getSession();
  if (!canHr(s.role)) return;
  const status = String(f.get("status"));
  if (!["approved", "rejected", "cancelled"].includes(status)) return;
  const supabase = await createClient();
  await supabase.from("leave_requests").update({ status, decided_by: s.userId, decided_at: new Date().toISOString() }).eq("id", String(f.get("id")));
  revalidatePath("/izin");
  revalidatePath("/puantaj");
}

export async function addLeaveAdjustment(f: FormData) {
  const s = await getSession();
  if (!["owner", "accountant", "hr"].includes(s.role)) return;
  const days = Number(String(f.get("days") ?? "").replace(",", "."));
  if (!Number.isFinite(days) || days === 0) return;
  const supabase = await createClient();
  await supabase.from("leave_adjustments").insert({
    company_id: s.companyId,
    employee_id: String(f.get("employeeId")),
    days,
    note: String(f.get("note") ?? "").trim() || "Devreden izin",
  });
  revalidatePath("/izin");
}

/* ------------------------------------------------------------------ */
/* Fazla mesai                                                         */
/* ------------------------------------------------------------------ */

async function monthlyTotals(supabase: Awaited<ReturnType<typeof createClient>>, ids: string[], onDate: string) {
  const { data } = await supabase.from("pay_contracts").select("employee_id, valid_from, total_net").in("employee_id", ids).lte("valid_from", onDate).order("valid_from");
  const m = new Map<string, number>();
  for (const c of data ?? []) m.set(c.employee_id, Number(c.total_net));
  return m;
}

/** items: "employeeId|date|minutes|rate" */
export async function approveOvertime(f: FormData) {
  const s = await getSession();
  if (!canHr(s.role)) return;
  const decision = f.get("decision") === "reject" ? "rejected" : "approved";
  const items = f.getAll("item").map(String).map((x) => {
    const [employeeId, date, minutes, rate] = x.split("|");
    return { employeeId: employeeId!, date: date!, minutes: Number(minutes), rate: Number(rate) };
  });
  if (!items.length) return;
  const supabase = await createClient();
  const totals = await monthlyTotals(supabase, [...new Set(items.map((i) => i.employeeId))], items.map((i) => i.date).sort().at(-1)!);
  const writeLedger = decision === "approved" && canManagePay(s.role);

  for (const it of items) {
    const amount = totals.has(it.employeeId) ? overtimePay(totals.get(it.employeeId)!, it.minutes, it.rate) : null;
    let ledgerId: string | null = null;
    if (writeLedger && amount) {
      const { data } = await supabase
        .from("ledger_entries")
        .insert({
          company_id: s.companyId,
          employee_id: it.employeeId,
          period: it.date.slice(0, 7),
          entry_date: it.date,
          type: "OVERTIME",
          channel: "NONE",
          amount,
          note: `Fazla mesai ${Math.floor(it.minutes / 60)} sa ${it.minutes % 60} dk ×${it.rate}`,
        })
        .select("id")
        .single();
      ledgerId = data?.id ?? null;
    }
    await supabase.from("overtime_records").upsert(
      {
        company_id: s.companyId,
        employee_id: it.employeeId,
        work_date: it.date,
        period: it.date.slice(0, 7),
        minutes: it.minutes,
        rate: it.rate,
        amount: decision === "approved" ? amount : null,
        source: "AUTO",
        status: decision,
        ledger_entry_id: ledgerId,
        decided_by: s.userId,
        decided_at: new Date().toISOString(),
      },
      { onConflict: "employee_id,work_date" },
    );
  }
  revalidatePath("/fazla-mesai");
}

export async function addManualOvertime(_: { message: string } | null, f: FormData): Promise<{ message: string }> {
  const s = await getSession();
  if (!canHr(s.role)) return { message: "Yetkiniz yok." };
  const employeeId = String(f.get("employeeId") ?? "");
  const date = String(f.get("date") ?? "");
  const hours = Number(String(f.get("hours") ?? "").replace(",", "."));
  const rate = Number(f.get("rate") ?? 1.5);
  if (!employeeId || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !(hours > 0)) return { message: "Personel, tarih ve saat zorunlu." };
  const minutes = roundKurus(hours * 60);
  const fd = new FormData();
  fd.append("item", `${employeeId}|${date}|${minutes}|${rate}`);
  fd.append("decision", "approve");
  await approveOvertime(fd);
  return { message: "Fazla mesai eklendi ve onaylandı." };
}

export async function cancelOvertime(f: FormData) {
  const s = await getSession();
  if (!canHr(s.role)) return;
  const supabase = await createClient();
  const id = String(f.get("id"));
  const { data: r } = await supabase.from("overtime_records").select("ledger_entry_id").eq("id", id).single();
  if (r?.ledger_entry_id && canManagePay(s.role)) await supabase.rpc("void_ledger_entry", { p_id: r.ledger_entry_id, p_reason: "Fazla mesai iptal edildi" });
  await supabase.from("overtime_records").delete().eq("id", id);
  revalidatePath("/fazla-mesai");
}
