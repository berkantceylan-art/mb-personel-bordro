import "server-only";
import type { createClient } from "@/lib/supabase/server";

type SB = Awaited<ReturnType<typeof createClient>>;

export type AttReportRow = {
  employee_id: string; name: string; dept: string;
  forgot: number; forgotOver: number; forgotPending: number;
  missing: number; late: number; lateMin: number; early: number; earlyMin: number; absent: number;
  overtimeDays: number; overtimeMin: number; longDays: number;
  fixed: number; accepted: number; open: number; total: number;
};

export const monthBounds = (period: string) => {
  const [y, m] = period.split("-").map(Number) as [number, number];
  return { from: `${period}-01`, to: m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01` };
};

/** Personel bazında aylık puantaj hataları (hata = eksik okutma, geç, erken, devamsızlık, kart unuttu, 11 saat aşımı) */
export async function attReport(sb: SB, period: string, employeeId?: string): Promise<AttReportRow[]> {
  const { from, to } = monthBounds(period);
  let dq = sb.from("att_days").select("employee_id, issues, state, late_min, early_min, overtime_min, employees(first_name, last_name, departments(name))").gte("work_date", from).lt("work_date", to).limit(20000);
  let cq = sb.from("att_corrections").select("employee_id, action, status, over_limit, detail").gte("work_date", from).lt("work_date", to).limit(20000);
  let pq = sb.from("punch_requests").select("employee_id, status, note").gte("on_date", from).lt("on_date", to).limit(20000);
  if (employeeId) { dq = dq.eq("employee_id", employeeId); cq = cq.eq("employee_id", employeeId); pq = pq.eq("employee_id", employeeId); }
  const [{ data: days, error }, { data: corr }, { data: reqs }] = await Promise.all([dq, cq, pq]);
  if (error) throw new Error(error.message);
  const m = new Map<string, AttReportRow>();
  const get = (id: string, emp?: { first_name: string; last_name: string; departments: { name: string } | null } | null) => {
    let r = m.get(id);
    if (!r) {
      r = { employee_id: id, name: emp ? `${emp.first_name} ${emp.last_name}` : "?", dept: emp?.departments?.name ?? "Bölümsüz", forgot: 0, forgotOver: 0, forgotPending: 0, missing: 0, late: 0, lateMin: 0, early: 0, earlyMin: 0, absent: 0, overtimeDays: 0, overtimeMin: 0, longDays: 0, fixed: 0, accepted: 0, open: 0, total: 0 };
      m.set(id, r);
    } else if (emp && r.name === "?") { r.name = `${emp.first_name} ${emp.last_name}`; r.dept = emp.departments?.name ?? "Bölümsüz"; }
    return r;
  };
  for (const d of (days ?? []) as unknown as { employee_id: string; issues: string[]; state: string; late_min: number; early_min: number; overtime_min: number; employees: { first_name: string; last_name: string; departments: { name: string } | null } | null }[]) {
    const r = get(d.employee_id, d.employees);
    if (d.issues.includes("MISSING_IN") || d.issues.includes("MISSING_OUT")) r.missing++;
    if (d.issues.includes("LATE")) { r.late++; r.lateMin += d.late_min; }
    if (d.issues.includes("EARLY")) { r.early++; r.earlyMin += d.early_min; }
    if (d.issues.includes("ABSENT")) r.absent++;
    if (d.overtime_min > 0) { r.overtimeDays++; r.overtimeMin += d.overtime_min; }
    if (d.issues.includes("LONG_DAY")) r.longDays++;
    if (d.state === "fixed") r.fixed++;
    if (d.state === "accepted") r.accepted++;
    if (d.state === "open") r.open++;
  }
  for (const c of (corr ?? []) as { employee_id: string; action: string; status: string; over_limit: boolean }[]) {
    if (c.action !== "forgot_card") continue;
    const r = get(c.employee_id);
    if (c.status === "applied") r.forgot++;
    if (c.status === "pending") r.forgotPending++;
    if (c.over_limit) r.forgotOver++;
  }
  // Personelin kendi bildirimi (kontrol merkezinden açılanlar zaten yukarıda sayıldı)
  for (const q of (reqs ?? []) as { employee_id: string; status: string; note: string | null }[]) {
    if ((q.note ?? "").startsWith("Kontrol merkezi")) continue;
    const r = get(q.employee_id);
    if (q.status === "approved") r.forgot++;
    if (q.status === "pending") r.forgotPending++;
  }
  // Fazla mesai hata değildir; toplamda sayılmaz
  for (const r of m.values()) r.total = r.missing + r.late + r.early + r.absent + r.forgot + r.longDays;
  if (m.size) {
    const missingNames = [...m.values()].filter((r) => r.name === "?").map((r) => r.employee_id);
    if (missingNames.length) {
      const { data } = await sb.from("employees").select("id, first_name, last_name, departments(name)").in("id", missingNames);
      for (const e of (data ?? []) as unknown as { id: string; first_name: string; last_name: string; departments: { name: string } | null }[]) {
        const r = m.get(e.id)!; r.name = `${e.first_name} ${e.last_name}`; r.dept = e.departments?.name ?? "Bölümsüz";
      }
    }
  }
  return [...m.values()].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, "tr"));
}
