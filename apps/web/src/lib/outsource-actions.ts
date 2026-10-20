"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";

type Res = { ok: boolean; message: string; batch?: string | null; job?: number; jobId?: string; patient?: string | null; customer?: string | null; problem?: boolean };
const SQL = "Önce mbdental-ortodonti.sql dosyasını Supabase'de çalıştırın.";
const missing = (m: string) => (/outsource|schema cache|does not exist/i.test(m) ? SQL : m);

async function guard() {
  const s = await getSession();
  if (!s.logistics) throw new Error("Laboratuvar modülü için yetkiniz yok.");
  return s;
}
const done = () => { revalidatePath("/isler/ortodonti"); };

/** Seçili işleri dış laboratuvara gönder (günlük liste oluşur) */
export async function outsourceSend(jobIds: string[], partyId: string, note: string): Promise<Res> {
  try {
    await guard();
    if (!jobIds.length) return { ok: false, message: "İş seçin." };
    if (!partyId) return { ok: false, message: "Dış laboratuvar seçin." };
    const sb = await createClient();
    const { data, error } = await sb.rpc("outsource_send", { p_jobs: jobIds, p_party: partyId, p_note: note || null });
    if (error) return { ok: false, message: missing(error.message) };
    const r = data as { batch: string | null; no: number | null; jobs: number };
    done();
    return r.batch ? { ok: true, message: `${r.jobs} iş gönderildi · liste #${r.no}`, batch: r.batch } : { ok: false, message: "Seçilen işler zaten gönderilmiş." };
  } catch (e) { return { ok: false, message: e instanceof Error ? e.message : String(e) }; }
}

/** İş geldi (iş no / barkod) */
export async function outsourceReceive(code: string, problem: boolean, note: string): Promise<Res> {
  try {
    await guard();
    if (!code.trim()) return { ok: false, message: "İş numarası okutun." };
    const sb = await createClient();
    const { data, error } = await sb.rpc("outsource_receive", { p_code: code.trim(), p_problem: problem, p_note: note || null });
    if (error) return { ok: false, message: missing(error.message) };
    const r = data as { ok: boolean; message: string; job?: number; job_id?: string; patient?: string | null; customer?: string | null; problem?: boolean };
    if (r.ok) done();
    return { ok: r.ok, message: r.message, job: r.job, jobId: r.job_id, patient: r.patient, customer: r.customer, problem: r.problem };
  } catch (e) { return { ok: false, message: e instanceof Error ? e.message : String(e) }; }
}

export async function outsourceUndo(id: string): Promise<Res> {
  try {
    await guard();
    const sb = await createClient();
    const { error } = await sb.rpc("outsource_undo", { p_id: id });
    if (error) return { ok: false, message: missing(error.message) };
    done();
    return { ok: true, message: "Geri alındı; iş yeniden dışarıda görünüyor." };
  } catch (e) { return { ok: false, message: e instanceof Error ? e.message : String(e) }; }
}

/** Bir cariyi dış laboratuvar olarak işaretle / kaldır */
export async function setOutsourceLab(partyId: string, on: boolean): Promise<Res> {
  try {
    await guard();
    const sb = await createClient();
    const { error } = await sb.from("fin_parties").update({ outsource_lab: on }).eq("id", partyId);
    if (error) return { ok: false, message: missing(error.message) };
    done();
    return { ok: true, message: on ? "Dış laboratuvar eklendi." : "Kaldırıldı." };
  } catch (e) { return { ok: false, message: e instanceof Error ? e.message : String(e) }; }
}

/** İş numaralarından id */
export async function jobIdsByNo(nos: string[]): Promise<string[]> {
  await guard();
  const n = nos.map((x) => Number(x.replace(/\D/g, ""))).filter((x) => x > 0).slice(0, 200);
  if (!n.length) return [];
  const sb = await createClient();
  const { data } = await sb.from("jobs").select("id").in("no", n);
  return ((data ?? []) as { id: string }[]).map((d) => d.id);
}
