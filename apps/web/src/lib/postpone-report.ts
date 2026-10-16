import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export type PRow = { id: string; at: string; job_id: string; no: number; patient: string | null; customer_id: string | null; customer: string; status: string; from: string | null; to: string; days: number; reason: string; note: string | null; by: string; count: number };
export type PFilter = { from: string; to: string; reason?: string; customer?: string };

/** Erteleme kayıtları (filtreli) — rapor ekranı ve Excel ortak */
export async function loadPostpones(sb: SupabaseClient, f: PFilter): Promise<{ rows: PRow[]; error?: string }> {
  let q = sb.from("job_postpones").select("id, job_id, from_date, to_date, reason, note, by_user, created_at, jobs(no, patient, customer_id, status, postpone_count)")
    .gte("created_at", `${f.from}T00:00:00+03:00`).lte("created_at", `${f.to}T23:59:59+03:00`).order("created_at", { ascending: false }).limit(5000);
  if (f.reason) q = q.eq("reason", f.reason);
  const { data, error } = await q;
  if (error) return { rows: [], error: error.message };
  type Raw = { id: string; job_id: string; from_date: string | null; to_date: string; reason: string; note: string | null; by_user: string | null; created_at: string; jobs: { no: number; patient: string | null; customer_id: string | null; status: string; postpone_count: number | null } | null };
  let raw = (data ?? []) as unknown as Raw[];
  if (f.customer) raw = raw.filter((r) => r.jobs?.customer_id === f.customer);
  const custIds = [...new Set(raw.map((r) => r.jobs?.customer_id).filter(Boolean))] as string[];
  const userIds = [...new Set(raw.map((r) => r.by_user).filter(Boolean))] as string[];
  const [{ data: cs }, { data: es }] = await Promise.all([
    custIds.length ? sb.from("lab_customers").select("id, name").in("id", custIds) : Promise.resolve({ data: [] }),
    userIds.length ? sb.from("employees").select("user_id, first_name, last_name").in("user_id", userIds) : Promise.resolve({ data: [] }),
  ]);
  const cn = new Map(((cs ?? []) as { id: string; name: string }[]).map((c) => [c.id, c.name]));
  const un = new Map(((es ?? []) as { user_id: string; first_name: string; last_name: string }[]).map((e) => [e.user_id, `${e.first_name} ${e.last_name}`]));
  const dd = (a: string | null, b: string) => (a ? Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000) : 0);
  return {
    rows: raw.map((r) => ({ id: r.id, at: r.created_at, job_id: r.job_id, no: r.jobs?.no ?? 0, patient: r.jobs?.patient ?? null, customer_id: r.jobs?.customer_id ?? null, customer: cn.get(r.jobs?.customer_id ?? "") ?? "—",
      status: r.jobs?.status ?? "", from: r.from_date, to: r.to_date, days: dd(r.from_date, r.to_date), reason: r.reason, note: r.note, by: un.get(r.by_user ?? "") ?? "—", count: Number(r.jobs?.postpone_count ?? 0) })),
  };
}
