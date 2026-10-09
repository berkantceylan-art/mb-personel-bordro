/**
 * Patron ekranı veri katmanı: bugün, para, ödeme takvimi, insanlar, bölümler, riskler, onaylar.
 * Tutarlar kuruş. Her yükleyici yalnız kendi sekmesinin ihtiyacını okur.
 */
import { annualLeaveEntitlement, isoWeekday, netToGross, nextPeriod, paramsFor, periodBounds, previousPeriod } from "@mb/core";
import { loadCompliance } from "@/lib/compliance";
import { contractsAt } from "@/lib/contracts";
import { computePayroll, type PayrollRow } from "@/lib/payroll";
import type { createClient } from "@/lib/supabase/server";
import { fetchAll, loadMonth, type MonthData } from "@/lib/timekeeping";

type SB = Awaited<ReturnType<typeof createClient>>;

export const addDays = (iso: string, n: number) => new Date(Date.parse(iso.slice(0, 10) + "T00:00:00Z") + n * 86_400_000).toISOString().slice(0, 10);
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b.slice(0, 10)) - Date.parse(a.slice(0, 10))) / 86_400_000);
const addMonths = (iso: string, n: number) => {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  return new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), Math.min(d, last))).toISOString().slice(0, 10);
};
const params = (date: string) => { try { return paramsFor(Number(date.slice(0, 4))); } catch { return paramsFor(2026); } };

/* ------------------------------------------------------------------ Bugün */
export interface TodayPerson { id: string; name: string; dept: string; note?: string }
export interface TodayData {
  expected: number;
  present: TodayPerson[];
  late: TodayPerson[];
  absent: TodayPerson[];
  leave: TodayPerson[];
  off: number;
  depts: Array<{ dept: string; expected: number; present: number; missing: number }>;
}

/** Vardiyası tanımlı olmayan personelde okutma olmayan iş günü de devamsızlık sayılır (ayda hiç okutması olmayanlar takip dışı) */
type Cell = NonNullable<ReturnType<MonthData["cells"]["get"]>> extends Map<string, infer C> ? C : never;
export const tracked = (row: Map<string, Cell> | undefined) => !!row && [...row.values()].some((c) => c.punchCount > 0);
export const missed = (c: Cell, d: string) => c.employed && c.punchCount === 0 && (c.status === "ABSENT" || (c.status === "NO_SHIFT" && !c.leaveCode && !c.holidayName && isoWeekday(d) !== 7));

/** Bugün kim geldi, kim geç kaldı, kim yok; bölüm doluluğu (puantaj kuralları ile) */
export function todayFrom(month: MonthData, today: string): TodayData {
  const out: TodayData = { expected: 0, present: [], late: [], absent: [], leave: [], off: 0, depts: [] };
  const dm = new Map<string, { expected: number; present: number }>();
  for (const e of month.employees) {
    const row = month.cells.get(e.id);
    const c = row?.get(today);
    if (!c || !c.employed) continue;
    const p = { id: e.id, name: e.name, dept: e.dept };
    const d = dm.get(e.dept) ?? { expected: 0, present: 0 };
    const fullLeave = c.status === "LEAVE" || (c.leaveCode && !c.leaveCode.startsWith("SAATLIK"));
    if (fullLeave) { out.leave.push({ ...p, note: leaveLabel(c.leaveCode) }); continue; }
    if (!tracked(row)) continue;
    if ((c.status === "WEEKLY_OFF" || c.status === "HOLIDAY") && c.punchCount === 0) { out.off++; continue; }
    out.expected++; d.expected++;
    if (c.punchCount > 0) {
      out.present.push(p); d.present++;
      if (c.lateMin > 0) out.late.push({ ...p, note: `${c.lateMin} dk` });
    } else out.absent.push(p);
    dm.set(e.dept, d);
  }
  out.depts = [...dm.entries()].map(([dept, v]) => ({ dept, ...v, missing: v.expected - v.present })).sort((a, b) => b.missing - a.missing || a.dept.localeCompare(b.dept, "tr"));
  return out;
}
const LEAVE_LABEL: Record<string, string> = { YILLIK: "Yıllık izin", RAPOR: "Raporlu", UCRETSIZ: "Ücretsiz izin", MAZERET: "Mazeret izni", EVLILIK: "Evlilik izni", OLUM: "Ölüm izni", DOGUM: "Doğum izni", BABALIK: "Babalık izni" };
const leaveLabel = (code: string | null) => (code ? LEAVE_LABEL[code] ?? "İzinli" : "İzinli");

/* ------------------------------------------------------------------ Para */
export interface MoneyData {
  period: string;
  people: number;
  totalCost: number;       // personele net hakediş + devlete giden (SGK, vergi)
  netAccrued: number;      // personele net hakediş (banka + elden)
  salary: number;          // net maaş (mesai hariç)
  overtime: number;        // net fazla mesai
  sgk: number;             // işçi + işveren SGK ve işsizlik
  tax: number;             // gelir + damga vergisi
  officialNet: number;     // resmi (bankadan) net
  cashNet: number;         // elden net (hakediş − resmi net)
  advances: number;        // ay içindeki avanslar
  paidBank: number;
  paidCash: number;
  remainBank: number;
  remainCash: number;
  bes: number;
  garnishment: number;
  rows: PayrollRow[];
  byEmployee: Map<string, { cost: number; accrued: number; cash: number }>;
}

export function moneyFrom(period: string, rows: PayrollRow[], advances: number): MoneyData {
  const m: MoneyData = { period, people: rows.length, totalCost: 0, netAccrued: 0, salary: 0, overtime: 0, sgk: 0, tax: 0, officialNet: 0, cashNet: 0, advances, paidBank: 0, paidCash: 0, remainBank: 0, remainCash: 0, bes: 0, garnishment: 0, rows, byEmployee: new Map() };
  for (const r of rows) {
    const b = r.result.breakdown;
    const sgk = b.sgkEmployee + b.unemploymentEmployee + b.sgkEmployer + b.unemploymentEmployer;
    const tax = b.incomeTax + b.stampTax;
    const accrued = r.ledger.accrued;
    const ot = r.ledger.overtimeCash + r.ledger.overtimeOfficial;
    const cash = Math.max(0, accrued - b.net);
    m.netAccrued += accrued; m.overtime += ot; m.salary += accrued - ot; m.sgk += sgk; m.tax += tax;
    m.officialNet += b.net; m.cashNet += cash; m.totalCost += accrued + sgk + tax;
    m.paidBank += r.ledger.paidBank; m.paidCash += r.ledger.paidCash; m.remainBank += r.pay.bank; m.remainCash += r.pay.cash;
    m.bes += b.bes; m.garnishment += r.result.garnishmentTotal;
    m.byEmployee.set(r.employeeId, { cost: accrued + sgk + tax, accrued, cash });
  }
  return m;
}

export async function loadMoney(sb: SB, period: string): Promise<MoneyData> {
  const [rows, adv] = await Promise.all([
    computePayroll(sb, period),
    fetchAll<{ amount: number }>((a, b) => sb.from("ledger_entries").select("amount").eq("period", period).eq("type", "ADVANCE").is("voided_at", null).order("id").range(a, b)),
  ]);
  return moneyFrom(period, rows, adv.reduce((a, x) => a + Number(x.amount), 0));
}

/** Son 12 ayın net hakedişi ve personel sayısı (grafik için, hafif sorgu) */
export async function loadTrend(sb: SB, period: string, emps: EmpLite[]) {
  const periods: string[] = [];
  for (let p = period, i = 0; i < 12; i++, p = previousPeriod(p)) periods.unshift(p);
  const rows = await fetchAll<{ period: string; accrued: number | null }>((a, b) => sb.from("ledger_period_summary").select("period, accrued").in("period", periods).order("employee_id").order("period").range(a, b));
  const acc = new Map<string, number>();
  for (const r of rows) acc.set(r.period, (acc.get(r.period) ?? 0) + Number(r.accrued ?? 0));
  return periods.map((p) => ({ period: p, accrued: acc.get(p) ?? 0, headcount: headcountAt(emps, periodBounds(p).end) }));
}

/* ------------------------------------------------------------------ Ödeme takvimi */
export interface CalItem { date: string; title: string; detail: string; amount: number; status: "paid" | "due" | "late" | "info"; href?: string; period: string }

interface SgkRow { period: string; accrued: number; paid: number; paid_on: string | null; due_on: string | null; tax_accrued?: number; tax_paid?: number; tax_paid_on?: string | null }

/** Önümüzdeki 30 gün (ve gecikmiş olanlar): maaş, elden, BES, icra, SGK, muhtasar, çıkış ödemeleri */
export async function loadCalendar(sb: SB, today: string, money: Map<string, MoneyData>, payDay: number, emps: EmpLite[]): Promise<CalItem[]> {
  const cur = today.slice(0, 7);
  const periods = [previousPeriod(cur), cur];
  const { data: sgkRows } = await sb.from("sgk_payments").select("*").in("period", periods);
  const sgk = new Map(((sgkRows ?? []) as SgkRow[]).map((r) => [r.period, r]));
  const items: CalItem[] = [];
  for (const p of periods) {
    const m = money.get(p);
    if (!m) continue;
    const label = periodName(p);
    const pay = `${nextPeriod(p)}-${String(payDay).padStart(2, "0")}`;
    const st = (remain: number, due: string): CalItem["status"] => (remain <= 0 ? "paid" : due < today ? "late" : "due");
    items.push({ date: pay, period: p, title: `${label} maaşı · banka`, detail: m.remainBank > 0 ? `${m.rows.filter((r) => r.pay.bank > 0).length} kişiye kalan` : "ödendi", amount: m.remainBank > 0 ? m.remainBank : m.paidBank, status: st(m.remainBank, pay), href: `/kalan?donem=${p}` });
    items.push({ date: pay, period: p, title: `${label} maaşı · elden`, detail: m.remainCash > 0 ? `${m.rows.filter((r) => r.pay.cash > 0).length} kişiye kalan` : "ödendi", amount: m.remainCash > 0 ? m.remainCash : m.paidCash, status: st(m.remainCash, pay), href: `/kalan?donem=${p}` });
    const settled = m.remainBank <= 0;
    if (m.bes > 0) items.push({ date: pay, period: p, title: `${label} BES`, detail: "maaşla birlikte şirkete aktarılır", amount: m.bes, status: settled ? "paid" : pay < today ? "late" : "due" });
    if (m.garnishment > 0) items.push({ date: pay, period: p, title: `${label} icra / nafaka`, detail: "icra dairelerine yatırılır", amount: m.garnishment, status: settled ? "paid" : pay < today ? "late" : "due", href: "/icra" });
    const row = sgk.get(p);
    const due = row?.due_on ?? `${nextPeriod(p)}-26`;
    const estSgk = m.sgk;
    const sgkRemain = row ? Number(row.accrued) - Number(row.paid) : estSgk;
    items.push({ date: due, period: p, title: `${label} SGK primi`, detail: row ? (sgkRemain > 0 ? "tahakkuk girildi" : `ödendi${row.paid_on ? " " + row.paid_on.split("-").reverse().join(".") : ""}`) : "tahmini (tahakkuk girilmedi)", amount: sgkRemain > 0 ? sgkRemain : Number(row?.paid ?? 0), status: row && Number(row.accrued) > 0 && sgkRemain <= 0 ? "paid" : due < today ? "late" : "due", href: "/patron?sekme=para#sgk" });
    const taxAcc = row?.tax_accrued ? Number(row.tax_accrued) : 0;
    const taxRemain = taxAcc ? taxAcc - Number(row?.tax_paid ?? 0) : m.tax;
    items.push({ date: due, period: p, title: `${label} muhtasar (GV + DV)`, detail: taxAcc ? (taxRemain > 0 ? "tahakkuk girildi" : "ödendi") : "tahmini (tahakkuk girilmedi)", amount: taxRemain > 0 ? taxRemain : Number(row?.tax_paid ?? 0), status: taxAcc && taxRemain <= 0 ? "paid" : due < today ? "late" : "due", href: "/patron?sekme=para#sgk" });
  }
  // Çıkış ödemeleri: son 30 gün / önümüzdeki 30 gün ayrılanlar (tahmini kıdem + ihbar)
  const leavers = emps.filter((e) => e.termination_date && e.termination_date >= addDays(today, -30) && e.termination_date <= addDays(today, 30));
  if (leavers.length) {
    const contracts = await contractsAt(sb, leavers.map((e) => e.id), today);
    for (const e of leavers) {
      const c = contracts.get(e.id);
      if (!c || !e.hire_date) continue;
      const est = severance(e.hire_date, e.termination_date!, c, e.termination_code);
      if (!est.kidem && !est.ihbar) continue;
      items.push({ date: e.termination_date!, period: e.termination_date!.slice(0, 7), title: `Çıkış ödemesi · ${nameOf(e)}`, detail: `tahmini${est.kidem ? " kıdem" : ""}${est.ihbar ? " + ihbar" : ""} · kesinleştirin`, amount: est.kidem + est.ihbar, status: "info", href: `/personel/${e.id}/cikis` });
    }
  }
  const from = addDays(today, -45);
  const to = addDays(today, 30);
  return items
    .filter((i) => (i.status === "late" ? true : i.date >= from && i.date <= to) && (i.amount > 0 || i.status === "late"))
    .filter((i) => !(i.status === "paid" && i.date < addDays(today, -10)))
    .sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title, "tr"));
}
const MONTHS = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
export const periodName = (p: string) => MONTHS[Number(p.slice(5, 7)) - 1] ?? p;

/* ------------------------------------------------------------------ Kıdem / ihbar */
type ContractLite = { totalNet: number; insuranceType: "MIN_WAGE" | "FIXED_NET"; fixedOfficialNet?: number };
/** Resmi brüt (bordrodaki) ve gerçek brüt (elden dâhil anlaşılan net üzerinden) */
export function grossOf(c: ContractLite, date: string) {
  const prm = params(date);
  const month = Number(date.slice(5, 7));
  const official = c.insuranceType === "MIN_WAGE" ? prm.minWageGross : netToGross({ targetNet: c.fixedOfficialNet ?? 0, month, cumulativeTaxBaseBefore: 0, besRate: 0, params: prm }).gross;
  const real = Math.max(official, netToGross({ targetNet: c.totalNet, month, cumulativeTaxBaseBefore: 0, besRate: 0, params: prm }).gross);
  return { official, real };
}
const NO_KIDEM = new Set(["03", "25", "26"]);
const IHBAR = new Set(["04", "05", "15", "17"]);
export function severance(hire: string, end: string, c: ContractLite, code?: string | null, basis: "official" | "real" = "official") {
  const years = (daysBetween(hire, end) + 1) / 365;
  const g = grossOf(c, end)[basis];
  const kidem = years >= 1 && !(code && NO_KIDEM.has(code)) ? Math.round(g * years) : 0;
  const weeks = years < 0.5 ? 2 : years < 1.5 ? 4 : years < 3 ? 6 : 8;
  const ihbarDue = code ? IHBAR.has(code) : true;
  return { years, kidem, ihbar: ihbarDue ? Math.round((g / 30) * weeks * 7) : 0, weeks };
}

/* ------------------------------------------------------------------ İnsanlar */
export interface EmpLite { id: string; first_name: string; last_name: string; hire_date: string | null; termination_date: string | null; termination_reason: string | null; termination_code: string | null; status: string; departments: unknown }
export const nameOf = (e: { first_name: string; last_name: string }) => `${e.first_name} ${e.last_name === "-" ? "" : e.last_name}`.trim();
export const deptOf = (e: { departments: unknown }) => (e.departments as { name: string } | null)?.name ?? "Bölümsüz";
export const headcountAt = (emps: EmpLite[], d: string) => emps.filter((e) => e.hire_date && e.hire_date <= d && (!e.termination_date || e.termination_date >= d)).length;

export async function loadEmployees(sb: SB): Promise<EmpLite[]> {
  const { data } = await sb.from("employees").select("id, first_name, last_name, hire_date, termination_date, termination_reason, termination_code, status, departments(name)");
  return (data ?? []) as EmpLite[];
}

/** Son 3 ayın devamsızlık ve geç kalma sıralaması; bölüm devamsızlık oranı (bu ay) */
export async function loadAttendanceStats(sb: SB, today: string, current: MonthData) {
  const p1 = previousPeriod(today.slice(0, 7));
  const p2 = previousPeriod(p1);
  const months = [current, await loadMonth(sb, p1), await loadMonth(sb, p2)];
  const per = new Map<string, { name: string; dept: string; absent: number; late: number; lateMin: number }>();
  const dept = new Map<string, { expected: number; absent: number }>();
  for (const m of months) {
    for (const e of m.employees) {
      const row = m.cells.get(e.id);
      if (!row || !tracked(row)) continue;
      const s = per.get(e.id) ?? { name: e.name, dept: e.dept, absent: 0, late: 0, lateMin: 0 };
      for (const [d, c] of row) {
        if (d >= today || !c.employed) continue;
        const miss = missed(c, d);
        if (miss) s.absent++;
        if (c.lateMin > 0) { s.late++; s.lateMin += c.lateMin; }
        if (m === current && (c.status === "WORKED" || c.status === "INCOMPLETE" || miss || (c.status === "NO_SHIFT" && c.punchCount > 0))) {
          const g = dept.get(e.dept) ?? { expected: 0, absent: 0 };
          g.expected++; if (miss) g.absent++;
          dept.set(e.dept, g);
        }
      }
      per.set(e.id, s);
    }
  }
  const list = [...per.entries()].map(([id, v]) => ({ id, ...v }));
  return {
    topAbsent: list.filter((x) => x.absent > 0).sort((a, b) => b.absent - a.absent).slice(0, 5),
    topLate: list.filter((x) => x.late > 0).sort((a, b) => b.late - a.late || b.lateMin - a.lateMin).slice(0, 5),
    deptAbsence: dept,
    from: `${p2}-01`,
  };
}

/** Yaklaşan iş yıldönümleri (14 gün) ve doğum günleri (7 gün) */
export async function loadCelebrations(sb: SB, today: string, emps: EmpLite[]) {
  const active = emps.filter((e) => e.status !== "terminated");
  const md = (d: string) => d.slice(5, 10);
  const within = (d: string, n: number) => {
    for (let i = 0; i <= n; i++) if (md(addDays(today, i)) === md(d)) return i;
    return -1;
  };
  const anniversaries = active
    .filter((e) => e.hire_date)
    .map((e) => ({ e, i: within(e.hire_date!, 14), years: Number(today.slice(0, 4)) - Number(e.hire_date!.slice(0, 4)) + (md(e.hire_date!) < md(today) ? 1 : 0) }))
    .filter((x) => x.i >= 0 && x.years >= 1)
    .sort((a, b) => a.i - b.i)
    .map((x) => ({ id: x.e.id, name: nameOf(x.e), dept: deptOf(x.e), inDays: x.i, years: x.years }));
  const { data: privs } = await sb.from("employee_private").select("employee_id, birth_date").not("birth_date", "is", null);
  const byId = new Map(active.map((e) => [e.id, e]));
  const birthdays = (privs ?? [])
    .map((p) => ({ e: byId.get(p.employee_id), i: within(String(p.birth_date), 7) }))
    .filter((x) => x.e && x.i >= 0)
    .sort((a, b) => a.i - b.i)
    .map((x) => ({ id: x.e!.id, name: nameOf(x.e!), dept: deptOf(x.e!), inDays: x.i }));
  return { anniversaries, birthdays };
}

/* ------------------------------------------------------------------ Riskler */
export interface RiskData {
  kidemOfficial: number; kidemReal: number; ihbarOfficial: number; ihbarReal: number;
  topKidem: Array<{ id: string; name: string; dept: string; years: number; official: number; real: number }>;
  leaveDays: number; leaveCost: number; leaveUnknown: number;
  topLeave: Array<{ id: string; name: string; dept: string; days: number; cost: number }>;
  overtime: Array<{ id: string; name: string; dept: string; hours: number }>;
  docs: { expired: number; soon: number; missing: number; list: Array<{ id: string; name: string; what: string; when: string; level: string }> };
  probation: Array<{ id: string; name: string; dept: string; ends: string; inDays: number }>;
  garnish: { people: number; files: number; enforcement: number; alimony: number; monthly: number };
}

export async function loadRisks(sb: SB, today: string, emps: EmpLite[], monthlyGarnish: number): Promise<RiskData> {
  const active = emps.filter((e) => e.status !== "terminated" && e.hire_date && e.hire_date <= today);
  const ids = active.map((e) => e.id);
  const year = today.slice(0, 4);
  const [contracts, used, adj, { data: privs }, ot, training, health, { data: garn }] = await Promise.all([
    contractsAt(sb, ids, today),
    fetchAll<{ employee_id: string; days: number; leave_types: unknown }>((a, b) => sb.from("leave_requests").select("employee_id, days, leave_types!inner(code)").eq("status", "approved").eq("leave_types.code", "YILLIK").order("id").range(a, b)),
    fetchAll<{ employee_id: string; days: number }>((a, b) => sb.from("leave_adjustments").select("employee_id, days").order("id").range(a, b)),
    sb.from("employee_private").select("employee_id, birth_date"),
    fetchAll<{ employee_id: string; minutes: number }>((a, b) => sb.from("overtime_records").select("employee_id, minutes").eq("status", "approved").gte("work_date", `${year}-01-01`).lte("work_date", `${year}-12-31`).order("id").range(a, b)),
    loadCompliance(sb, "TRAINING"),
    loadCompliance(sb, "HEALTH"),
    sb.from("garnishment_files").select("employee_id, kind").eq("status", "active"),
  ]);
  const birth = new Map((privs ?? []).map((p) => [p.employee_id, p.birth_date as string | null]));
  const usedBy = new Map<string, number>(); for (const u of used) usedBy.set(u.employee_id, (usedBy.get(u.employee_id) ?? 0) + Number(u.days));
  const adjBy = new Map<string, number>(); for (const u of adj) adjBy.set(u.employee_id, (adjBy.get(u.employee_id) ?? 0) + Number(u.days));
  const otBy = new Map<string, number>(); for (const o of ot) otBy.set(o.employee_id, (otBy.get(o.employee_id) ?? 0) + Number(o.minutes));

  const r: RiskData = { kidemOfficial: 0, kidemReal: 0, ihbarOfficial: 0, ihbarReal: 0, topKidem: [], leaveDays: 0, leaveCost: 0, leaveUnknown: 0, topLeave: [], overtime: [], docs: { expired: 0, soon: 0, missing: 0, list: [] }, probation: [], garnish: { people: 0, files: 0, enforcement: 0, alimony: 0, monthly: monthlyGarnish } };
  for (const e of active) {
    const c = contracts.get(e.id);
    const base = { id: e.id, name: nameOf(e), dept: deptOf(e) };
    if (c) {
      const o = severance(e.hire_date!, today, c, null, "official");
      const re = severance(e.hire_date!, today, c, null, "real");
      r.kidemOfficial += o.kidem; r.kidemReal += re.kidem; r.ihbarOfficial += o.ihbar; r.ihbarReal += re.ihbar;
      if (re.kidem) r.topKidem.push({ ...base, years: o.years, official: o.kidem, real: re.kidem });
      const ent = annualLeaveEntitlement(e.hire_date!, today, birth.get(e.id) ?? null);
      const left = Math.max(0, ent.earned + (adjBy.get(e.id) ?? 0) - (usedBy.get(e.id) ?? 0));
      if (o.years >= 2 && !adjBy.has(e.id) && !usedBy.has(e.id)) r.leaveUnknown++;
      if (left > 0) {
        const cost = Math.round((c.totalNet / 30) * left);
        r.leaveDays += left; r.leaveCost += cost;
        r.topLeave.push({ ...base, days: left, cost });
      }
    }
    const h = (otBy.get(e.id) ?? 0) / 60;
    if (h >= 200) r.overtime.push({ ...base, hours: Math.round(h * 10) / 10 });
    if (e.hire_date! > addMonths(today, -3)) {
      const ends = addMonths(e.hire_date!, 2);
      const inDays = daysBetween(today, ends);
      if (inDays >= -3 && inDays <= 21) r.probation.push({ ...base, ends, inDays });
    }
  }
  r.topKidem.sort((a, b) => b.real - a.real); r.topKidem = r.topKidem.slice(0, 5);
  r.topLeave.sort((a, b) => b.days - a.days); r.topLeave = r.topLeave.slice(0, 5);
  r.overtime.sort((a, b) => b.hours - a.hours);
  r.probation.sort((a, b) => a.inDays - b.inDays);
  for (const [cat, d] of [["İSG eğitimi", training], ["Sağlık muayenesi", health]] as const) {
    r.docs.expired += d.counts.expired; r.docs.soon += d.counts.d7 + d.counts.d15 + d.counts.d30; r.docs.missing += d.counts.missing;
    for (const a of d.alerts.filter((x) => x.level !== "MISSING")) r.docs.list.push({ id: a.employeeId, name: a.name, what: `${cat} · ${a.typeName}`, when: a.daysLeft === null ? "" : a.daysLeft < 0 ? `${-a.daysLeft} gün geçti` : a.daysLeft === 0 ? "bugün" : `${a.daysLeft} gün kaldı`, level: a.level });
  }
  r.docs.list = r.docs.list.slice(0, 12);
  const g = (garn ?? []) as Array<{ employee_id: string; kind: string }>;
  r.garnish.files = g.length; r.garnish.people = new Set(g.map((x) => x.employee_id)).size;
  r.garnish.enforcement = g.filter((x) => x.kind === "ENFORCEMENT").length; r.garnish.alimony = g.filter((x) => x.kind === "ALIMONY").length;
  return r;
}

/* ------------------------------------------------------------------ Onaylar */
export async function loadApprovals(sb: SB) {
  const emp = "employees(first_name, last_name, departments(name))";
  const [adv, leave, ot, meal, prof, punch] = await Promise.all([
    sb.from("advance_requests").select(`id, employee_id, amount, reason, created_at, ${emp}`).eq("status", "pending").order("created_at"),
    sb.from("leave_requests").select(`id, employee_id, start_date, end_date, days, hours, note, ${emp}, leave_types(name)`).eq("status", "pending").order("start_date"),
    sb.from("overtime_records").select(`id, employee_id, work_date, minutes, rate, note, ${emp}`).eq("status", "pending").order("work_date"),
    sb.from("meal_requests").select("id, on_date, head_count, note, departments(name)").eq("status", "pending").order("on_date"),
    sb.from("profile_change_requests").select(`id, employee_id, changes, created_at, ${emp}`).eq("status", "pending").order("created_at"),
    sb.from("punch_requests").select(`id, employee_id, on_date, at_time, direction, note, ${emp}`).eq("status", "pending").order("on_date"),
  ]);
  return { adv: adv.data ?? [], leave: leave.data ?? [], ot: ot.data ?? [], meal: meal.data ?? [], prof: prof.data ?? [], punch: punch.data ?? [] };
}
export type Approvals = Awaited<ReturnType<typeof loadApprovals>>;
export const approvalCount = (a: Approvals) => a.adv.length + a.leave.length + a.ot.length + a.meal.length + a.prof.length + a.punch.length;

export { isoWeekday };
