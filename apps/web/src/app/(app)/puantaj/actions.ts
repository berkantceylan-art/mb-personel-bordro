"use server";
import { revalidatePath } from "next/cache";
import { legalParams } from "@/lib/legal";
import { absenceSides, pairPunches, parseDeviceFile, periodBounds, type PaySide } from "@mb/core";
import { contractsAt, SIDE_LABEL } from "@/lib/contracts";
import { createClient } from "@/lib/supabase/server";
import { canManagePay, getSession } from "@/lib/session";
import { loadMonth } from "@/lib/timekeeping";
import { cumulativeBases } from "@/lib/payroll";
import { must } from "@/lib/flash";
import { importPunchText } from "@/lib/pdks-import";

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
  const r = await importPunchText(supabase, s.companyId, text, file.name, s.userId);
  if (!r.ok) return { ok: false, message: r.message, errors: r.errors.slice(0, 5).map((e) => `Satır ${e.line}: ${e.reason}`) };
  await supabase.rpc("link_punches_to_employees", { p_company: s.companyId });
  const parsed = { punches: r.punches, errors: r.errors };
  const byCard = new Set(r.punches.filter((p) => !r.unknown.has(p.cardNo)).map((p) => p.cardNo));
  const unknown = r.unknown, inserted = r.inserted, dup = r.dup;

  const known = parsed.punches.filter((p) => byCard.has(p.cardNo));
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

/**
 * Puantajdaki devamsızlık + ücretsiz izin + rapor günlerini dönem cari hesabına kesinti olarak yazar (resmi / elden ayrı).
 * Şirket kuralı: RAPOR günleri her zaman hem resmi hem elden kısımdan günlük ücret kadar kesilir
 * (rapor parasını SGK personele ayrıca öder). Devamsızlık / ücretsiz izin seçilen tarafa göre kesilir.
 * Tekrar çalıştırılabilir: bordro kesintileri cariye yazılmamış personelin önceki "Eksik gün" kesintisi
 * iptal edilip puantajın son haliyle yeniden yazılır (sonradan girilen rapor da yansır).
 */
export async function applyMissingDays(_: { ok: boolean; message: string } | null, f: FormData): Promise<{ ok: boolean; message: string }> {
  const s = await getSession();
  if (!canManagePay(s.role)) return { ok: false, message: "Yetkiniz yok." };
  const period = String(f.get("period"));
  const sideRaw = f.get("pay_side");
  const side: PaySide = sideRaw === "OFFICIAL" || sideRaw === "CASH" ? sideRaw : "BOTH";
  const only = String(f.get("employeeId") ?? "");
  const supabase = await createClient();
  const month = await loadMonth(supabase, period, only ? { employeeId: only } : {});
  const { end } = periodBounds(period);

  const ids = month.employees.map((e) => e.id);
  const [contracts, existing, postedLines, legal] = await Promise.all([
    contractsAt(supabase, ids, end),
    supabase.from("ledger_entries").select("id, employee_id, amount, pay_side, days").eq("period", period).eq("type", "DEDUCTION").like("note", "Eksik gün%").is("voided_at", null).in("employee_id", ids),
    supabase.from("payroll_lines").select("employee_id").eq("period", period).eq("posted", true),
    legalParams(supabase, Number(period.slice(0, 4))),
  ]);
  const posted = new Set((postedLines.data ?? []).map((r) => r.employee_id));
  const oldByEmp = new Map<string, Array<{ id: string; amount: number; pay_side: string | null; days: number | null }>>();
  for (const r of existing.data ?? []) oldByEmp.set(r.employee_id, [...(oldByEmp.get(r.employee_id) ?? []), { id: r.id, amount: Number(r.amount), pay_side: r.pay_side, days: r.days }]);
  const cum = await cumulativeBases(supabase, period, month.employees.map((e) => ({ id: e.id, hire_date: e.hireDate })), contracts);
  const monthNo = Number(period.slice(5, 7));
  const takesOfficial = side === "OFFICIAL" || side === "BOTH";
  const takesCash = side === "CASH" || side === "BOTH";

  const rows: Record<string, unknown>[] = [];
  const toVoid: string[] = [];
  let people = 0, changed = 0, skippedPosted = 0;
  for (const e of month.employees) {
    const c = contracts.get(e.id);
    if (!c) continue;
    let absent = 0, unpaid = 0, sick = 0;
    for (const cell of month.cells.get(e.id)!.values()) {
      if (!cell.employed) continue;
      if (cell.status === "ABSENT") absent++;
      else if (cell.leaveCode === "UCRETSIZ") unpaid++;
      else if (cell.leaveCode === "RAPOR") sick++;
    }
    const other = absent + unpaid;
    const officialDays = Math.min(30, sick + (takesOfficial ? other : 0));
    const cashDays = Math.min(30, sick + (takesCash ? other : 0));
    const parts = [absent && `devamsızlık ${absent}`, unpaid && `ücretsiz izin ${unpaid}`, sick && `rapor ${sick}`].filter(Boolean).join(", ");
    const ctx = { contract: c, month: monthNo, cumulativeTaxBaseBefore: cum.get(e.id) ?? 0, params: legal.params };
    const want: Array<{ side: "OFFICIAL" | "CASH"; amount: number; grossAmount: number | null; days: number }> = [];
    if (officialDays) {
      const a = absenceSides(ctx, officialDays);
      if (a.officialNet > 0) want.push({ side: "OFFICIAL", amount: a.officialNet, grossAmount: a.officialGross, days: officialDays });
    }
    if (cashDays) {
      const a = absenceSides(ctx, cashDays);
      if (a.cash > 0) want.push({ side: "CASH", amount: a.cash, grossAmount: null, days: cashDays });
    }
    const old = oldByEmp.get(e.id) ?? [];
    const same = old.length === want.length && want.every((w) => old.some((o) => o.pay_side === w.side && o.amount === w.amount && Number(o.days ?? 0) === w.days));
    if (same) continue;
    if (posted.has(e.id)) { skippedPosted++; continue; }
    if (old.length) { toVoid.push(...old.map((o) => o.id)); changed++; }
    if (!want.length) continue;
    people++;
    for (const l of want) {
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
        days: l.days,
        note: `Eksik gün: ${l.days} (${parts}) · ${l.side === "OFFICIAL" ? "resmi" : "elden"}`,
      });
    }
  }
  for (const id of toVoid) {
    const { error } = await supabase.rpc("void_ledger_entry", { p_id: id, p_reason: "Puantaj değişti; eksik gün yeniden hesaplandı" });
    if (error) return { ok: false, message: error.message };
  }
  if (rows.length) {
    const { error } = await supabase.from("ledger_entries").insert(rows);
    if (error) return { ok: false, message: error.message };
  }
  revalidatePath("/puantaj");
  revalidatePath("/donemler");
  revalidatePath("/ay-sonu");
  revalidatePath("/bordro");
  revalidatePath("/bordro/sihirbaz");
  const msg = people || changed
    ? `${people} personele eksik gün kesintisi yazıldı${changed ? ` (${changed} kişinin önceki kesintisi güncellendi)` : ""}. Rapor günleri resmi + elden kesildi; diğer eksik günler: ${SIDE_LABEL[side]}.`
    : "Değişen eksik gün yok.";
  return { ok: true, message: msg + (skippedPosted ? ` ${skippedPosted} kişinin bordro kesintileri cariye yazıldığı için değiştirilmedi (önce Bordro'da geri alın).` : "") };
}

