import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";

export type Person = { id: string; name: string; role: string; me: boolean };
export type QueueJob = { id: string; no: number; patient: string | null; customer: string | null; due: string | null; holder: string | null; since: string | null };

/** Kontrol hattı ekranları için: akış kişileri, ben, aşamadaki işler */
export async function lineData(stage: "chief" | "qc" | "dispatch") {
  const s = await getSession();
  const supabase = await createClient();
  const [{ data: list, error }, { data: jobs }] = await Promise.all([
    supabase.rpc("prd_people_list"),
    supabase.rpc("prd_open_jobs"),
  ]);
  const people = ((list ?? []) as { employee_id: string; name: string; flow_role: string; me: boolean }[]).map((p) => ({ id: p.employee_id, name: p.name, role: p.flow_role, me: p.me }));
  const me = people.find((p) => p.me) ?? null;
  const canPick = (s.modules.production ?? 0) >= 3 || s.logistics;
  const queue: QueueJob[] = ((jobs ?? []) as { id: string; no: number; patient: string | null; customer: string | null; due_date: string | null; flow_stage: string; holder: string | null; holder_since: string | null }[])
    .filter((j) => j.flow_stage === stage)
    .map((j) => ({ id: j.id, no: j.no, patient: j.patient, customer: j.customer, due: j.due_date, holder: j.holder, since: j.holder_since }));
  return { s, people, me, canPick, queue, error, allowed: !!me || canPick || (s.modules.production ?? 0) >= 2 };
}
