import { alertLevel, complianceStatus, type ComplianceCell, type ComplianceType, type HazardClass } from "@mb/core";
import type { createClient } from "@/lib/supabase/server";
import { todayIso } from "@/lib/session";

type SB = Awaited<ReturnType<typeof createClient>>;
export type Category = "TRAINING" | "HEALTH";

export interface ComplianceData {
  hazard: HazardClass;
  types: Array<ComplianceType & { code: string; minHours: number | null }>;
  employees: Array<{ id: string; name: string; dept: string }>;
  cells: Map<string, Map<string, ComplianceCell>>; // emp → type → cell
  alerts: Array<{ employeeId: string; name: string; dept: string; typeId: string; typeName: string; status: string; expiresOn: string | null; daysLeft: number | null; level: string }>;
  counts: { expired: number; d7: number; d15: number; d30: number; missing: number };
}

export async function loadCompliance(supabase: SB, category: Category, opts: { employeeId?: string } = {}): Promise<ComplianceData> {
  const today = todayIso();
  let eq = supabase.from("employees").select("id, first_name, last_name, company_id, departments(name)").eq("status", "active").order("first_name");
  if (opts.employeeId) eq = eq.eq("id", opts.employeeId);
  const [{ data: emps }, { data: typeRows }, { data: company }] = await Promise.all([
    eq,
    supabase.from("compliance_types").select("*").eq("category", category).eq("active", true).order("sort_order"),
    supabase.from("companies").select("hazard_class").limit(1).maybeSingle(),
  ]);
  const ids = (emps ?? []).map((e) => e.id);
  const recs = ids.length
    ? category === "TRAINING"
      ? (await supabase.from("training_records").select("employee_id, type_id, done_on, expires_on").in("employee_id", ids)).data ?? []
      : ((await supabase.from("health_exams").select("employee_id, type_id, exam_date, expires_on").in("employee_id", ids)).data ?? []).map((r) => ({ ...r, done_on: r.exam_date }))
    : [];

  const hazard = (company?.hazard_class ?? "COK") as HazardClass;
  const types = (typeRows ?? []).map((t) => ({
    id: t.id as string,
    code: t.code as string,
    name: t.name as string,
    validityMonths: t.validity_months as number | null,
    validityByClass: t.validity_by_class as ComplianceType["validityByClass"],
    required: t.required as boolean,
    minHours: t.min_hours === null ? null : Number(t.min_hours),
  }));
  const employees = (emps ?? [])
    .map((e) => ({ id: e.id, name: `${e.first_name} ${e.last_name}`, dept: (e.departments as unknown as { name: string } | null)?.name ?? "Bölümsüz" }))
    .sort((a, b) => a.dept.localeCompare(b.dept, "tr") || a.name.localeCompare(b.name, "tr"));

  const byKey = new Map<string, Array<{ doneOn: string; expiresOn: string | null }>>();
  for (const r of recs) {
    const k = `${r.employee_id}|${r.type_id}`;
    byKey.set(k, [...(byKey.get(k) ?? []), { doneOn: r.done_on as string, expiresOn: r.expires_on as string | null }]);
  }

  const cells = new Map<string, Map<string, ComplianceCell>>();
  const alerts: ComplianceData["alerts"] = [];
  const counts = { expired: 0, d7: 0, d15: 0, d30: 0, missing: 0 };
  for (const e of employees) {
    const row = new Map<string, ComplianceCell>();
    for (const t of types) {
      const c = complianceStatus(byKey.get(`${e.id}|${t.id}`) ?? [], t, hazard, today);
      row.set(t.id, c);
      const lvl = alertLevel(c.daysLeft);
      if (c.status === "MISSING" && t.required) {
        counts.missing++;
        alerts.push({ employeeId: e.id, name: e.name, dept: e.dept, typeId: t.id, typeName: t.name, status: "MISSING", expiresOn: null, daysLeft: null, level: "MISSING" });
      } else if (lvl) {
        if (lvl === "EXPIRED") counts.expired++;
        else if (lvl === "D7") counts.d7++;
        else if (lvl === "D15") counts.d15++;
        else counts.d30++;
        alerts.push({ employeeId: e.id, name: e.name, dept: e.dept, typeId: t.id, typeName: t.name, status: c.status, expiresOn: c.expiresOn, daysLeft: c.daysLeft, level: lvl });
      }
    }
    cells.set(e.id, row);
  }
  const order: Record<string, number> = { EXPIRED: 0, D7: 1, D15: 2, D30: 3, MISSING: 4 };
  alerts.sort((a, b) => order[a.level]! - order[b.level]! || (a.daysLeft ?? 0) - (b.daysLeft ?? 0));
  return { hazard, types, employees, cells, alerts, counts };
}

export const HAZARD_LABEL: Record<HazardClass, string> = { AZ: "Az tehlikeli", TEHLIKELI: "Tehlikeli", COK: "Çok tehlikeli" };

export function cellStyle(c: ComplianceCell): { cls: string; text: string } {
  switch (c.status) {
    case "VALID": return { cls: "bg-ok-bg text-ok", text: "✓" };
    case "ONCE": return { cls: "bg-ok-bg text-ok", text: "✓" };
    case "SOON": return { cls: "bg-warn-bg text-warn font-bold", text: `${c.daysLeft}g` };
    case "EXPIRED": return { cls: "bg-bad-bg text-bad font-bold", text: "!" };
    default: return { cls: "bg-[#F3F6F9] text-[#9AA6B2]", text: "—" };
  }
}
