/**
 * Yıllık izin hesap motoru (İş K. md. 53-61, Yıllık Ücretli İzin Yönetmeliği).
 * - Hak ediş: her tamamlanan hizmet yılı için 14 / 20 / 26 iş günü; 18 yaş ve altı, 50 yaş ve üstüne en az 20 gün.
 * - Hak ediş tarihi, hizmetten sayılmayan süreler (ücretsiz izin, girilen kesintiler) kadar ileri kayar.
 * - Kullanılan izin en eski hak ediş yılından düşülür (FIFO); böylece hangi yılın izninin biriktiği görülür.
 * Cumartesi iş günüdür; pazar ve resmi tatil izinden sayılmaz, arife yarım gün sayılır.
 */
import { annualLeaveForYear } from "@mb/core";
import type { createClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/timekeeping";

type SB = Awaited<ReturnType<typeof createClient>>;
const DAY = 86_400_000;
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
const ts = (d: string) => Date.parse(d.slice(0, 10) + "T12:00:00Z");
export const addDaysIso = (d: string, n: number) => iso(ts(d) + n * DAY);
const addYears = (d: string, n: number) => {
  const [y, m, dd] = d.slice(0, 10).split("-").map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y + n, m - 1, dd, 12));
  if (t.getUTCMonth() !== m - 1) t.setUTCDate(0); // 29 Şubat → 28 Şubat
  return iso(t.getTime());
};
const ageAt = (birth: string | null | undefined, on: string) => {
  if (!birth) return undefined;
  const [by, bm, bd] = birth.split("-").map(Number) as [number, number, number];
  const [y, m, d] = on.split("-").map(Number) as [number, number, number];
  return y - by - (m < bm || (m === bm && d < bd) ? 1 : 0);
};

export type Holidays = Map<string, boolean>; // tarih → yarım gün mü
/** İzin gün sayısı: pazar ve tam gün resmi tatil sayılmaz, arife yarım gün */
export function leaveWorkdays(start: string, end: string, hol: Holidays) {
  let n = 0;
  for (let t = ts(start); t <= ts(end); t += DAY) {
    const d = iso(t);
    if (new Date(t).getUTCDay() === 0) continue;
    const h = hol.get(d);
    if (h === false) continue;
    n += h === true ? 0.5 : 1;
  }
  return n;
}
/** İzin bitişinden (ve yol izninden) sonraki ilk iş günü = işe başlama tarihi */
export function returnDate(end: string, hol: Holidays, travelDays = 0) {
  let d = end, left = travelDays;
  while (left > 0) { d = addDaysIso(d, 1); if (new Date(ts(d)).getUTCDay() !== 0 && hol.get(d) !== false) left--; }
  do d = addDaysIso(d, 1); while (new Date(ts(d)).getUTCDay() === 0 || hol.get(d) === false);
  return d;
}

export type Gap = { start: string; end: string; reason: string };
export type UsedLeave = { id?: string; start: string; end: string; days: number };
export type LedgerYear = { k: number; date: string; days: number; age?: number; used: number; left: number; gapDays: number };
export type Ledger = {
  base: string; years: LedgerYear[]; opening: { days: number; used: number; left: number };
  earned: number; adjust: number; used: number; balance: number;
  next: { date: string; days: number; k: number }; completedYears: number;
  /** En eski kullanılmamış hak ediş yılı (birikme göstergesi) */
  oldestOpen: string | null;
};

const overlapDays = (g: Gap, until: string) => {
  const s = ts(g.start), e = Math.min(ts(g.end), ts(until) - DAY);
  return e >= s ? Math.round((e - s) / DAY) + 1 : 0;
};

/** Personelin yıl yıl izin defteri */
export function buildLedger(o: { hire: string; seniorityStart?: string | null; birth?: string | null; gaps: Gap[]; adjust: number; used: UsedLeave[]; asOf: string }): Ledger {
  const base = o.seniorityStart || o.hire;
  const years: LedgerYear[] = [];
  const annivAt = (k: number) => {
    // Kesinti günleri hak ediş tarihini öteler; öteleme yeni kesintileri kapsayabileceği için sabitlenene kadar tekrarla
    let shift = 0;
    for (let i = 0; i < 6; i++) {
      const d = addDaysIso(addYears(base, k), shift);
      const s2 = o.gaps.reduce((a, g) => a + overlapDays(g, d), 0);
      if (s2 === shift) return { date: d, gap: shift };
      shift = s2;
    }
    return { date: addDaysIso(addYears(base, k), shift), gap: shift };
  };
  let k = 1;
  let prevGap = 0;
  for (;; k++) {
    const a = annivAt(k);
    if (a.date > o.asOf) break;
    const age = ageAt(o.birth, a.date);
    years.push({ k, date: a.date, days: annualLeaveForYear(k, age), age, used: 0, left: 0, gapDays: a.gap - prevGap });
    prevGap = a.gap;
    if (k > 60) break;
  }
  const na = annivAt(k);
  // FIFO: önce devir/açılış, sonra en eski yıl
  const opening = { days: o.adjust, used: 0, left: o.adjust };
  let usedTotal = o.used.reduce((s, u) => s + Number(u.days), 0);
  const totalUsed = usedTotal;
  if (opening.left > 0) { const x = Math.min(opening.left, usedTotal); opening.used = x; opening.left -= x; usedTotal -= x; }
  for (const y of years) { const x = Math.min(y.days, usedTotal); y.used = x; y.left = y.days - x; usedTotal -= x; }
  const earned = years.reduce((s, y) => s + y.days, 0);
  const balance = Math.round((earned + o.adjust - totalUsed) * 10) / 10;
  const open = years.find((y) => y.left > 0);
  return {
    base, years, opening, earned, adjust: o.adjust, used: totalUsed, balance,
    next: { date: na.date, days: annualLeaveForYear(k, ageAt(o.birth, na.date)), k }, completedYears: years.length,
    oldestOpen: opening.left > 0 ? "devir" : open?.date ?? null,
  };
}

/** Bölüm eşzamanlı izin sınırı: yüzde ve kişi sınırından küçüğü (en az 1) */
export function deptLimit(headcount: number, pct: number | null, people: number | null) {
  const a = pct ? Math.max(1, Math.floor((headcount * pct) / 100)) : Infinity;
  const b = people ?? Infinity;
  const l = Math.min(a, b);
  return Number.isFinite(l) ? l : null;
}

export type LeaveEmp = {
  id: string; first_name: string; last_name: string; hire_date: string | null; leave_seniority_start: string | null; card_no: string | null;
  department_id: string | null; dept: string; status: string; termination_date: string | null; user_id: string | null;
};
export type LeaveRow = { id: string; employee_id: string; start_date: string; end_date: string; days: number; status: string; code: string; name: string; parent_id: string | null; stage: string | null; travel_days: number; created_at: string; note: string | null };
export type LeaveData = {
  emps: LeaveEmp[]; rows: LeaveRow[]; ledgers: Map<string, Ledger>; hol: Holidays; birth: Map<string, string | null>;
  depts: Array<{ id: string; name: string; leave_max_pct: number | null; leave_max_people: number | null }>;
  gaps: Map<string, Gap[]>; adjustments: Array<{ employee_id: string; days: number; note: string | null; created_at: string }>;
};

/** Tüm aktif personelin izin verisini ve defterini yükler (RLS: kullanıcının görebildiği personel) */
export async function loadLeaveData(sb: SB, asOf: string, opts: { includeTerminated?: boolean; companyId?: string } = {}): Promise<LeaveData> {
  const cid = opts.companyId;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const scope = <T,>(q: T): T => (cid ? (q as any).eq("company_id", cid) : q);
  let eq = sb.from("employees").select("id, first_name, last_name, hire_date, leave_seniority_start, card_no, department_id, status, termination_date, user_id, departments(name)").order("first_name");
  if (!opts.includeTerminated) eq = eq.neq("status", "terminated");
  eq = scope(eq);
  const [{ data: emps, error: empErr }, rowsRaw, adjs, { data: privs }, { data: hols }, { data: depts }] = await Promise.all([
    eq,
    fetchAll<Record<string, unknown>>((a, b) => scope(sb.from("leave_requests").select("id, employee_id, start_date, end_date, days, status, parent_id, stage, travel_days, created_at, note, leave_types(code, name)").in("status", ["approved", "pending"])).order("start_date").range(a, b)),
    fetchAll<{ employee_id: string; days: number; note: string | null; created_at: string }>((a, b) => scope(sb.from("leave_adjustments").select("employee_id, days, note, created_at")).order("created_at").range(a, b)),
    scope(sb.from("employee_private").select("employee_id, birth_date")),
    sb.from("public_holidays").select("date, half_day"),
    scope(sb.from("departments").select("id, name, leave_max_pct, leave_max_people")).order("name"),
  ]);
  if (empErr) throw new Error(empErr.message);
  let gapRows: Array<{ employee_id: string; start_date: string; end_date: string; reason: string }> = [];
  try { gapRows = await fetchAll((a, b) => scope(sb.from("leave_service_gaps").select("employee_id, start_date, end_date, reason")).order("start_date").range(a, b)); } catch { /* SQL çalışmadıysa */ }
  const hol: Holidays = new Map((hols ?? []).map((h) => [h.date as string, !!h.half_day]));
  const birth = new Map((privs ?? []).map((p) => [p.employee_id as string, p.birth_date as string | null]));
  const rows: LeaveRow[] = rowsRaw.map((r) => {
    const t = r.leave_types as { code: string; name: string } | null;
    return { id: r.id as string, employee_id: r.employee_id as string, start_date: r.start_date as string, end_date: r.end_date as string, days: Number(r.days), status: r.status as string, code: t?.code ?? "", name: t?.name ?? "", parent_id: (r.parent_id as string | null) ?? null, stage: (r.stage as string | null) ?? null, travel_days: Number(r.travel_days ?? 0), created_at: r.created_at as string, note: (r.note as string | null) ?? null };
  });
  const gaps = new Map<string, Gap[]>();
  const pushGap = (id: string, g: Gap) => gaps.set(id, [...(gaps.get(id) ?? []), g]);
  for (const g of gapRows) pushGap(g.employee_id, { start: g.start_date, end: g.end_date, reason: g.reason });
  for (const r of rows) if (r.status === "approved" && r.code === "UCRETSIZ" && !r.parent_id) pushGap(r.employee_id, { start: r.start_date, end: r.end_date, reason: "Ücretsiz izin" });
  const adjBy = new Map<string, number>();
  for (const a of adjs) adjBy.set(a.employee_id, (adjBy.get(a.employee_id) ?? 0) + Number(a.days));
  const list: LeaveEmp[] = ((emps ?? []) as Array<Record<string, unknown>>).map((e) => ({
    id: e.id as string, first_name: e.first_name as string, last_name: e.last_name as string, hire_date: e.hire_date as string | null, leave_seniority_start: (e.leave_seniority_start as string | null) ?? null,
    card_no: e.card_no as string | null, department_id: e.department_id as string | null, dept: (e.departments as { name: string } | null)?.name ?? "Bölümsüz",
    status: e.status as string, termination_date: e.termination_date as string | null, user_id: e.user_id as string | null,
  }));
  const ledgers = new Map<string, Ledger>();
  for (const e of list) {
    if (!e.hire_date) continue;
    const until = e.termination_date && e.termination_date < asOf ? e.termination_date : asOf;
    const used = rows.filter((r) => r.employee_id === e.id && r.status === "approved" && r.code === "YILLIK").map((r) => ({ id: r.id, start: r.start_date, end: r.end_date, days: r.days }));
    ledgers.set(e.id, buildLedger({ hire: e.hire_date, seniorityStart: e.leave_seniority_start, birth: birth.get(e.id), gaps: gaps.get(e.id) ?? [], adjust: adjBy.get(e.id) ?? 0, used, asOf: until }));
  }
  return { emps: list, rows, ledgers, hol, birth, depts: (depts ?? []).map((d) => ({ id: d.id as string, name: d.name as string, leave_max_pct: d.leave_max_pct === null || d.leave_max_pct === undefined ? null : Number(d.leave_max_pct), leave_max_people: (d.leave_max_people as number | null) ?? null })), gaps, adjustments: adjs };
}

/** Bir tarih aralığında bölümden izinde olan kişi sayısının en yüksek günü (saatlik izin ve rapor hariç) */
export function deptPeak(d: LeaveData, deptId: string | null, start: string, end: string, excludeId?: string) {
  const ids = new Set(d.emps.filter((e) => e.department_id === deptId).map((e) => e.id));
  let peak = 0, peakDay = start;
  const names = new Map(d.emps.map((e) => [e.id, `${e.first_name} ${e.last_name}`]));
  let who: string[] = [];
  for (let t = ts(start); t <= ts(end); t += DAY) {
    const day = iso(t);
    const on = d.rows.filter((r) => r.id !== excludeId && ids.has(r.employee_id) && r.code !== "SAATLIK" && r.code !== "RAPOR" && r.start_date <= day && r.end_date >= day);
    const people = [...new Set(on.map((r) => r.employee_id))];
    if (people.length > peak) { peak = people.length; peakDay = day; who = people.map((p) => names.get(p) ?? "?"); }
  }
  const dept = d.depts.find((x) => x.id === deptId);
  const limit = dept ? deptLimit(ids.size, dept.leave_max_pct, dept.leave_max_people) : null;
  return { peak, peakDay, who, limit, headcount: ids.size };
}

export const STAGE_LABEL: Record<string, string> = { chief: "Şef onayı bekliyor", hr: "İK onayı bekliyor" };
export const fmtDays = (n: number) => n.toLocaleString("tr-TR", { maximumFractionDigits: 1 });
