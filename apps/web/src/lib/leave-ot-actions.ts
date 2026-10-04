"use server";
import { revalidatePath } from "next/cache";
import { countLeaveDays, overtimeSides, roundKurus, sideLines, type PaySide } from "@mb/core";
import { contractsAt } from "@/lib/contracts";
import { cumulativeBases } from "@/lib/payroll";
import { createClient } from "@/lib/supabase/server";
import { canManagePay, getSession } from "@/lib/session";
import { done, fail, must } from "@/lib/flash";

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
  // Onay/ret yalnız bekleyen talepte, iptal yalnız onaylı izinde (çift tıklama veya eski ekran durumu değiştirmesin)
  const from = status === "cancelled" ? "approved" : "pending";
  const { data: changed, error } = await supabase
    .from("leave_requests")
    .update({ status, decided_by: s.userId, decided_at: new Date().toISOString() })
    .eq("id", String(f.get("id")))
    .eq("status", from)
    .select("id");
  if (error) await fail(error.message);
  if (!changed?.length) await fail("Bu talep zaten sonuçlanmış.");
  revalidatePath("/izin");
  revalidatePath("/talepler");
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

const parseSide = (v: FormDataEntryValue | null): PaySide => (v === "OFFICIAL" || v === "CASH" ? v : "BOTH");

/** items: "employeeId|date|minutes|rate" · pay_side: OFFICIAL | CASH | BOTH */
export async function approveOvertime(f: FormData) {
  const s = await getSession();
  if (!canHr(s.role)) return;
  const decision = f.get("decision") === "reject" ? "rejected" : "approved";
  const side = parseSide(f.get("pay_side"));
  const items = f.getAll("item").map(String).map((x) => {
    const [employeeId, date, minutes, rate] = x.split("|");
    return { employeeId: employeeId!, date: date!, minutes: Number(minutes), rate: Number(rate) };
  });
  if (!items.length) return;
  const supabase = await createClient();
  const contracts = await contractsAt(supabase, [...new Set(items.map((i) => i.employeeId))], items.map((i) => i.date).sort().at(-1)!);
  // Resmi net etkisi personelin yıl içi kümülatif matrahıyla hesaplanır (bordroyla aynı)
  const { data: emps } = await supabase.from("employees").select("id, hire_date").in("id", [...new Set(items.map((i) => i.employeeId))]);
  const cumByPeriod = new Map<string, Map<string, number>>();
  for (const p of new Set(items.map((i) => i.date.slice(0, 7)))) cumByPeriod.set(p, await cumulativeBases(supabase, p, emps ?? [], contracts));

  for (const it of items) {
    const c = contracts.get(it.employeeId);
    const cum = cumByPeriod.get(it.date.slice(0, 7))?.get(it.employeeId) ?? 0;
    const a = c ? overtimeSides({ contract: c, month: Number(it.date.slice(5, 7)), cumulativeTaxBaseBefore: cum }, it.minutes, it.rate) : null;
    const lines = a && decision === "approved" ? sideLines(a, side) : [];
    const { data: rec } = await supabase
      .from("overtime_records")
      .upsert(
        {
          company_id: s.companyId,
          employee_id: it.employeeId,
          work_date: it.date,
          period: it.date.slice(0, 7),
          minutes: it.minutes,
          rate: it.rate,
          pay_side: side,
          official_gross: a?.officialGross ?? null,
          official_net: a?.officialNet ?? null,
          cash_amount: a?.cash ?? null,
          amount: lines.reduce((x, l) => x + l.amount, 0) || null,
          source: f.get("manual") ? "MANUAL" : "AUTO",
          status: decision,
          decided_by: s.userId,
          decided_at: new Date().toISOString(),
        },
        { onConflict: "employee_id,work_date" },
      )
      .select("id")
      .single();
    if (!rec) await fail("Fazla mesai kaydedilemedi.");
    // Cari hesap yalnız sahip/muhasebe tarafından yazılır; ret ise önceki kayıtları iptal eder (boş liste)
    if (!canManagePay(s.role) || !rec) continue;
    const label = `Fazla mesai ${Math.floor(it.minutes / 60)} sa ${it.minutes % 60} dk ×${it.rate}`;
    // Öncekiler iptal + yenileri tek işlemde: aynı günü ikinci kez onaylamak çift ödeme yaratmaz
    const { error } = await supabase.rpc("set_overtime_ledger", {
      p_overtime: rec.id,
      p_lines: lines.map((l) => ({ side: l.side, amount: l.amount, gross: l.grossAmount, note: `${label} (${l.side === "OFFICIAL" ? "resmi, bordroya brüt" : "elden"})` })),
    });
    if (error) await fail(error.message);
  }
  revalidatePath("/fazla-mesai");
  if (!f.get("manual")) await done(`${items.length} fazla mesai ${decision === "approved" ? "onaylandı" : "reddedildi"}.`);
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
  fd.append("pay_side", String(f.get("pay_side") ?? "BOTH"));
  fd.append("manual", "1");
  await approveOvertime(fd);
  return { message: "Fazla mesai eklendi ve onaylandı." };
}

export async function cancelOvertime(f: FormData) {
  const s = await getSession();
  if (!canHr(s.role)) return;
  const supabase = await createClient();
  const id = String(f.get("id"));
  const [{ data: r }, { data: links }] = await Promise.all([
    supabase.from("overtime_records").select("ledger_entry_id").eq("id", id).single(),
    supabase.from("overtime_ledger_links").select("ledger_entry_id").eq("overtime_id", id),
  ]);
  const ids = [...(links ?? []).map((l) => l.ledger_entry_id as string), ...(r?.ledger_entry_id ? [r.ledger_entry_id as string] : [])];
  if (ids.length && !canManagePay(s.role)) await fail("Cari hesaba yazılmış fazla mesaiyi yalnız sahip veya muhasebe geri alabilir.");
  for (const lid of ids) {
    const { error } = await supabase.rpc("void_ledger_entry", { p_id: lid, p_reason: "Fazla mesai geri alındı" });
    if (error && !/zaten|iptal edilmiş/i.test(error.message)) await fail(error.message);
  }
  await must(supabase.from("overtime_records").delete().eq("id", id));
  revalidatePath("/fazla-mesai");
}
