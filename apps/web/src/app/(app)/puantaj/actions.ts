"use server";
import { revalidatePath } from "next/cache";
import { absenceSides, pairPunches, parseDeviceFile, periodBounds, sideLines, type PaySide } from "@mb/core";
import { contractsAt, SIDE_LABEL } from "@/lib/contracts";
import { createClient } from "@/lib/supabase/server";
import { canManagePay, getSession } from "@/lib/session";
import { loadMonth } from "@/lib/timekeeping";
import { cumulativeBases } from "@/lib/payroll";
import { must } from "@/lib/flash";

const canEdit = (r: string) => ["owner", "accountant", "hr", "branch_manager"].includes(r);

export interface ImportPunchResult {
  ok: boolean;
  message: string;
  unknown?: Array<{ cardNo: string; count: number }>;
  anomalies?: number;
  errors?: string[];
}

export async function importPunches(_: ImportPunchResult | null, f: FormData): Promise<ImportPunchResult> {
  const s = await getSession();
  if (!canEdit(s.role)) return { ok: false, message: "Yetkiniz yok." };
  const file = f.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, message: "Dosya seçin." };
  const text = await file.text();
  const supabase = await createClient();

  const { data: devices } = await supabase.from("devices").select("code, direction, branch_id");
  const deviceDirection = Object.fromEntries((devices ?? []).map((d) => [d.code, d.direction])) as Record<string, "IN" | "OUT">;
  const parsed = parseDeviceFile(text, Object.keys(deviceDirection).length ? { deviceDirection } : {});
  if (!parsed.punches.length) return { ok: false, message: "Dosyada okunabilir kayıt yok.", errors: parsed.errors.slice(0, 5).map((e) => `Satır ${e.line}: ${e.reason}`) };

  const { data: emps } = await supabase.from("employees").select("id, card_no, branch_id").not("card_no", "is", null);
  const byCard = new Map((emps ?? []).map((e) => [String(e.card_no).replace(/^0+/, ""), e]));
  const { data: branch } = await supabase.from("branches").select("id").order("created_at").limit(1).single();
  const deviceBranch = new Map((devices ?? []).map((d) => [d.code, d.branch_id as string]));

  const { data: imp } = await supabase
    .from("attendance_imports")
    .insert({ company_id: s.companyId, branch_id: branch!.id, file_name: file.name, punch_count: parsed.punches.length, error_count: parsed.errors.length })
    .select("id")
    .single();

  const unknown = new Map<string, number>();
  const rows = parsed.punches.map((p) => {
    const emp = byCard.get(p.cardNo.replace(/^0+/, ""));
    if (!emp) unknown.set(p.cardNo, (unknown.get(p.cardNo) ?? 0) + 1);
    return {
      company_id: s.companyId,
      branch_id: emp?.branch_id ?? deviceBranch.get(p.device) ?? branch!.id,
      card_no: p.cardNo,
      employee_id: emp?.id ?? null,
      device_code: p.device,
      direction: p.direction,
      punched_at: p.at.replace("T", " ") + ":00",
      source: "DEVICE",
      import_id: imp?.id ?? null,
    };
  });

  let inserted = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const { data, error } = await supabase
      .from("attendance_punches")
      .upsert(chunk, { onConflict: "company_id,card_no,direction,punched_at", ignoreDuplicates: true })
      .select("id");
    if (error) return { ok: false, message: `Kayıt hatası: ${error.message}` };
    inserted += data?.length ?? 0;
  }
  const dup = rows.length - inserted;
  if (imp) await supabase.from("attendance_imports").update({ duplicate_count: dup }).eq("id", imp.id);
  await supabase.rpc("link_punches_to_employees", { p_company: s.companyId });

  const known = parsed.punches.filter((p) => byCard.has(p.cardNo.replace(/^0+/, "")));
  const pr = pairPunches(known);
  revalidatePath("/puantaj");
  return {
    ok: true,
    message: `${parsed.punches.length} okutma okundu · ${inserted} yeni kayıt · ${dup} kayıt zaten vardı.`,
    unknown: [...unknown.entries()].map(([cardNo, count]) => ({ cardNo, count })),
    anomalies: pr.anomalies.filter((a) => a.kind === "MISSING_IN" || a.kind === "MISSING_OUT").length,
    errors: parsed.errors.slice(0, 10).map((e) => `Satır ${e.line}: ${e.reason}`),
  };
}

export async function addManualPunch(_: { message: string } | null, f: FormData): Promise<{ message: string }> {
  const s = await getSession();
  if (!canEdit(s.role)) return { message: "Yetkiniz yok." };
  const employeeId = String(f.get("employeeId"));
  const date = String(f.get("date"));
  const time = String(f.get("time"));
  const direction = f.get("direction") === "OUT" ? "OUT" : "IN";
  const reason = String(f.get("reason") ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return { message: "Tarih ve saat girin." };
  if (!reason) return { message: "Gerekçe zorunlu." };
  const supabase = await createClient();
  const { data: e } = await supabase.from("employees").select("card_no, branch_id").eq("id", employeeId).single();
  if (!e) return { message: "Personel bulunamadı." };
  const { error } = await supabase.from("attendance_punches").insert({
    company_id: s.companyId,
    branch_id: e.branch_id,
    card_no: e.card_no ?? `M-${employeeId.slice(0, 8)}`,
    employee_id: employeeId,
    direction,
    punched_at: `${date} ${time}:00`,
    source: "MANUAL",
    reason,
  });
  if (error) return { message: error.message.includes("duplicate") ? "Bu saatte aynı yönde kayıt zaten var." : error.message };
  revalidatePath("/puantaj");
  return { message: "Kayıt eklendi." };
}

export async function deletePunch(f: FormData) {
  const s = await getSession();
  if (!canEdit(s.role)) return;
  const supabase = await createClient();
  await must(supabase.from("attendance_punches").delete().eq("id", String(f.get("id"))));
  revalidatePath("/puantaj");
}

/** Puantajdaki devamsızlık + ücretsiz izin + rapor günlerini dönem cari hesabına kesinti olarak yazar (resmi / elden ayrı) */
export async function applyMissingDays(_: { ok: boolean; message: string } | null, f: FormData): Promise<{ ok: boolean; message: string }> {
  const s = await getSession();
  if (!canManagePay(s.role)) return { ok: false, message: "Yetkiniz yok." };
  const period = String(f.get("period"));
  const sideRaw = f.get("pay_side");
  const side: PaySide = sideRaw === "OFFICIAL" || sideRaw === "CASH" ? sideRaw : "BOTH";
  const supabase = await createClient();
  const month = await loadMonth(supabase, period);
  const { end } = periodBounds(period);

  const ids = month.employees.map((e) => e.id);
  const [contracts, existing] = await Promise.all([
    contractsAt(supabase, ids, end),
    supabase.from("ledger_entries").select("employee_id").eq("period", period).eq("type", "DEDUCTION").like("note", "Eksik gün%").is("voided_at", null),
  ]);
  const done = new Set((existing.data ?? []).map((r) => r.employee_id));
  const cum = await cumulativeBases(supabase, period, month.employees.map((e) => ({ id: e.id, hire_date: e.hireDate })), contracts);

  const rows: Record<string, unknown>[] = [];
  let people = 0;
  for (const e of month.employees) {
    const c = contracts.get(e.id);
    if (done.has(e.id) || !c) continue;
    let absent = 0, unpaid = 0, sick = 0;
    for (const cell of month.cells.get(e.id)!.values()) {
      if (!cell.employed) continue;
      if (cell.status === "ABSENT") absent++;
      else if (cell.leaveCode === "UCRETSIZ") unpaid++;
      else if (cell.leaveCode === "RAPOR") sick++;
    }
    const days = Math.min(30, absent + unpaid + sick);
    if (!days) continue;
    const parts = [absent && `devamsızlık ${absent}`, unpaid && `ücretsiz izin ${unpaid}`, sick && `rapor ${sick}`].filter(Boolean).join(", ");
    const lines = sideLines(absenceSides({ contract: c, month: Number(period.slice(5, 7)), cumulativeTaxBaseBefore: cum.get(e.id) ?? 0 }, days), side);
    if (!lines.length) continue;
    people++;
    for (const l of lines) {
      rows.push({
        company_id: s.companyId,
        employee_id: e.id,
        period,
        entry_date: end,
        type: "DEDUCTION",
        channel: "NONE",
        amount: l.amount,
        pay_side: l.side,
        gross_amount: l.grossAmount,
        days,
        note: `Eksik gün: ${days} (${parts}) · ${l.side === "OFFICIAL" ? "resmi" : "elden"}`,
      });
    }
  }
  if (rows.length) {
    const { error } = await supabase.from("ledger_entries").insert(rows);
    if (error) return { ok: false, message: error.message };
  }
  revalidatePath("/puantaj");
  revalidatePath("/donemler");
  return { ok: true, message: people ? `${people} personele eksik gün kesintisi yazıldı (${SIDE_LABEL[side]}).` : "Yazılacak eksik gün yok (daha önce yazılanlar atlanır)." };
}
