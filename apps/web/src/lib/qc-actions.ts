"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { flowError } from "@/lib/flow";
import { qcError } from "@/lib/qc";

const err = (m: string) => qcError(flowError(m));
const back = () => { revalidatePath("/kalite-hatti", "layout"); revalidatePath("/uretim", "layout"); };

export type JobCard = {
  ok: boolean; message?: string; id?: string; no?: number; patient?: string | null; doctor?: string | null; customer?: string | null; due?: string | null; stage?: string;
  shade?: string | null; description?: string | null; teeth?: Record<string, string>; received?: string[]; items?: { name: string; qty: number }[];
  checks?: { stage: string; passed: boolean; note: string | null; at: string; by: string | null }[]; rejects?: number; warnings?: string[]; holder?: string | null;
};

/** Kontrol ekranı: işi okut → elime al (rol uygunsa) ve kartını getir */
export async function qcOpen(code: string, employee: string | null, take: boolean): Promise<JobCard> {
  const supabase = await createClient();
  let warnings: string[] = [];
  if (take) {
    const { data, error } = await supabase.rpc("prd_flow_scan", { p_code: code.slice(0, 200), p_employee: employee || null, p_action: "take", p_reason: null, p_target: null });
    if (error && !/already_out/.test(error.message)) return { ok: false, message: err(error.message) };
    warnings = ((data as { warnings?: string[] } | null)?.warnings ?? []) as string[];
  }
  const raw = code.trim().toUpperCase().replace(/^(IS|İŞ|IŞ|JOB)[- ]?/, "");
  const uuid = code.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0];
  let q = supabase.from("jobs").select("id, no, patient, doctor_name, due_date, flow_stage, shade, shade_cervical, shade_incisal, description, teeth, received, holder_employee_id, lab_customers(name), job_items(name, qty, sort)");
  q = uuid ? q.eq("id", uuid) : /^\d{1,12}$/.test(raw) ? q.eq("no", Number(raw)) : q.ilike("slip_no", raw);
  const { data: j } = await q.limit(1).maybeSingle();
  if (!j) return { ok: false, message: "Bu kodla iş bulunamadı." };
  const job = j as unknown as { id: string; no: number; patient: string | null; doctor_name: string | null; due_date: string | null; flow_stage: string; shade: string | null; shade_cervical: string | null; shade_incisal: string | null; description: string | null; teeth: Record<string, string>; received: string[]; holder_employee_id: string | null; lab_customers: { name: string } | null; job_items: { name: string; qty: number; sort: number }[] };
  const [{ data: ch }, { data: tl }] = await Promise.all([
    supabase.from("job_qc_checks").select("stage, passed, note, at, employees!job_qc_checks_employee_id_fkey(first_name, last_name)").eq("job_id", job.id).order("at", { ascending: false }).limit(10),
    supabase.rpc("prd_job_timeline", { p_job: job.id }),
  ]);
  const holderRow = ((tl ?? []) as { action: string; who: string | null }[]).filter((x) => x.action === "take").pop();
  return {
    ok: true, id: job.id, no: job.no, patient: job.patient, doctor: job.doctor_name, customer: job.lab_customers?.name ?? null, due: job.due_date, stage: job.flow_stage,
    shade: [job.shade, job.shade_cervical && `boyun ${job.shade_cervical}`, job.shade_incisal && `kesici ${job.shade_incisal}`].filter(Boolean).join(" · ") || null,
    description: job.description, teeth: job.teeth ?? {}, received: job.received ?? [], items: [...job.job_items].sort((a, b) => a.sort - b.sort).map((i) => ({ name: i.name, qty: i.qty })),
    checks: ((ch ?? []) as unknown as { stage: string; passed: boolean; note: string | null; at: string; employees: { first_name: string; last_name: string } | null }[]).map((c) => ({ stage: c.stage, passed: c.passed, note: c.note, at: c.at, by: c.employees ? `${c.employees.first_name} ${c.employees.last_name}` : null })),
    rejects: ((tl ?? []) as { action: string }[]).filter((x) => x.action === "reject").length, warnings, holder: job.holder_employee_id ? holderRow?.who ?? null : null,
  };
}

export async function qcDecide(input: { code: string; employee: string | null; stage: "chief" | "qc"; pass: boolean; items: { key: string; label: string; ok: boolean }[]; note?: string; target?: string | null; photo?: string | null }): Promise<{ ok: boolean; message: string }> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("prd_qc_decide", {
    p_code: input.code.slice(0, 200), p_employee: input.employee || null, p_stage: input.stage, p_pass: input.pass, p_items: input.items.slice(0, 20),
    p_note: input.note?.slice(0, 500) || null, p_target: input.target || null, p_photo: input.photo?.startsWith("data:image/jpeg;base64,") ? input.photo : null,
  });
  if (error) return { ok: false, message: err(error.message) };
  back();
  return { ok: true, message: input.pass ? (input.stage === "chief" ? "Onaylandı → son kontrole gitti." : "Onaylandı → paketleme / çıkışa gitti.") : "Geri gönderildi." };
}

export type PackJob = { id: string; no: number; patient: string | null; doctor: string | null; status: string; due: string | null; qty: number; items: string | null };
export type PackData = { id: string; no: string; status: string; exited: boolean; customer: string | null; packer: string | null; created_at: string; closed_at: string | null; jobs: PackJob[] };

export async function packScan(code: string, employee: string | null, pkg: string | null): Promise<{ ok: boolean; message?: string; package?: PackData; duplicate?: boolean; warning?: string | null; job?: number }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("prd_pack_scan", { p_code: code.slice(0, 200), p_employee: employee || null, p_package: pkg || null });
  if (error) return { ok: false, message: err(error.message) };
  const d = data as { package: string; job: number; duplicate: boolean; warning: string | null };
  const { data: p } = await supabase.rpc("prd_pack_get", { p_package: d.package });
  back();
  return { ok: true, package: p as PackData, duplicate: d.duplicate, warning: d.warning, job: d.job };
}

export async function packGet(id: string): Promise<PackData | null> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("prd_pack_get", { p_package: id });
  return (data as PackData | null) ?? null;
}

export async function packRemove(job: string, pkg: string): Promise<PackData | null> {
  const supabase = await createClient();
  await supabase.rpc("prd_pack_remove", { p_job: job });
  back();
  return packGet(pkg);
}

export async function packClose(pkg: string, exit: boolean, note?: string): Promise<{ ok: boolean; message: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("prd_pack_close", { p_package: pkg, p_exit: exit, p_note: note ?? null });
  if (error) return { ok: false, message: err(error.message) };
  back();
  revalidatePath("/isler", "layout");
  return { ok: true, message: exit ? `Paket kapandı; ${data ?? 0} işin çıkışı yapıldı.` : "Paket kapandı (çıkış yapılmadı)." };
}
