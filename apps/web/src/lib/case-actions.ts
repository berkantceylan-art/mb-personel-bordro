"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import { kindOf, type FileKind } from "@/lib/case-files";

const ID = /^[0-9a-f-]{36}$/;
const MISSING = "Supabase'de 20261221000000_case_files.sql çalıştırılmalı.";
const miss = (m: string) => (/job_notes|kind|schema cache|does not exist|policy/.test(m) ? MISSING : m);

async function canWork() {
  const s = await getSession();
  return s.logistics || (s.modules.production ?? 0) >= 1 ? s : null;
}

/** ERP iş dosyası kaydı (job-files deposu) */
export async function recordJobFile(input: { jobId: string; path: string; name: string; size?: number; kind?: FileKind }) {
  const s = await getSession();
  if (!s.logistics) return { ok: false, message: "Yetkiniz yok." };
  if (!ID.test(input.jobId) || !input.path.startsWith(`${input.jobId}/`)) return { ok: false, message: "Geçersiz yol." };
  const kind = input.kind && ["photo", "scan", "design", "doc", "other"].includes(input.kind) ? input.kind : kindOf(input.name);
  const supabase = await createClient();
  let { error } = await supabase.from("job_files").insert({ job_id: input.jobId, path: input.path, name: input.name.slice(0, 200), kind, size: Math.round(input.size ?? 0) || null });
  if (error && /kind|size/.test(error.message)) ({ error } = await supabase.from("job_files").insert({ job_id: input.jobId, path: input.path, name: input.name.slice(0, 200) }));
  if (error) return { ok: false, message: miss(error.message) };
  revalidatePath(`/isler/${input.jobId}`);
  return { ok: true, message: "Yüklendi." };
}

export async function deleteJobFile(f: FormData) {
  const s = await getSession();
  if (!s.logistics) return;
  const id = String(f.get("id") ?? "");
  const jobId = String(f.get("job_id") ?? "");
  if (!ID.test(id) || !ID.test(jobId)) return;
  const supabase = await createClient();
  const { data } = await supabase.from("job_files").select("path").eq("id", id).eq("job_id", jobId).maybeSingle();
  if (!data) return;
  await supabase.storage.from("job-files").remove([data.path as string]);
  await supabase.from("job_files").delete().eq("id", id);
  revalidatePath(`/isler/${jobId}`);
}

/** İç not (hekim görmez) */
export async function addJobNote(f: FormData) {
  const s = await canWork();
  const jobId = String(f.get("job_id") ?? "");
  const body = String(f.get("body") ?? "").trim().slice(0, 4000);
  if (!s || !ID.test(jobId) || !body) return { ok: false, message: "Not boş olamaz." };
  const supabase = await createClient();
  const { error } = await supabase.from("job_notes").insert({ job_id: jobId, body });
  if (error) return { ok: false, message: miss(error.message) };
  revalidatePath(`/isler/${jobId}`);
  return { ok: true, message: "" };
}

export async function deleteJobNote(f: FormData) {
  const jobId = String(f.get("job_id") ?? "");
  const id = Number(f.get("id"));
  if (!ID.test(jobId) || !Number.isFinite(id)) return;
  const supabase = await createClient();
  await supabase.from("job_notes").delete().eq("id", id);
  revalidatePath(`/isler/${jobId}`);
}

/** Hekime portal mesajı (iş bağlı portal vakasına) */
export async function sendCaseMessage(f: FormData) {
  const s = await getSession();
  const jobId = String(f.get("job_id") ?? "");
  const body = String(f.get("body") ?? "").trim().slice(0, 4000);
  if (!s.logistics || !ID.test(jobId) || !body) return { ok: false, message: "Mesaj boş olamaz." };
  const supabase = await createClient();
  const { data: job } = await supabase.from("jobs").select("portal_case_id").eq("id", jobId).maybeSingle();
  if (!job?.portal_case_id) return { ok: false, message: "Bu iş bir portal vakasına bağlı değil." };
  const { error } = await supabase.from("portal_case_events").insert({ case_id: job.portal_case_id, kind: "message", body, from_lab: true, author: s.userId });
  if (error) return { ok: false, message: miss(error.message) };
  revalidatePath(`/isler/${jobId}`);
  return { ok: true, message: "" };
}

/** Laboratuvarın portal vakasına yüklediği dosyaları kaydet (hekim portalda görür) */
export async function recordCaseFiles(jobId: string, files: { path: string; name: string; size: number; mime: string }[]) {
  const s = await getSession();
  if (!s.logistics || !ID.test(jobId)) return { ok: false, message: "Yetkiniz yok." };
  const supabase = await createClient();
  const { data: job } = await supabase.from("jobs").select("portal_case_id, portal_cases(account_id)").eq("id", jobId).maybeSingle();
  const caseId = job?.portal_case_id as string | null;
  const acc = (job?.portal_cases as unknown as { account_id: string } | null)?.account_id;
  if (!caseId || !acc) return { ok: false, message: "Bu iş bir portal vakasına bağlı değil." };
  const rows = files
    .filter((x) => x.path.startsWith(`${acc}/${caseId}/`))
    .map((x) => ({ case_id: caseId, path: x.path, name: x.name.slice(0, 200), size: Math.round(x.size) || null, mime: x.mime.slice(0, 120) || null, from_lab: true }));
  if (!rows.length) return { ok: false, message: "Geçersiz dosya." };
  const { error } = await supabase.from("portal_case_files").insert(rows);
  if (error) return { ok: false, message: miss(error.message) };
  await supabase.from("portal_case_events").insert({ case_id: caseId, kind: "file", body: rows.map((r) => r.name).join(", ").slice(0, 4000), from_lab: true, author: s.userId });
  revalidatePath(`/isler/${jobId}`);
  return { ok: true, message: `${rows.length} dosya hekime gönderildi.` };
}
