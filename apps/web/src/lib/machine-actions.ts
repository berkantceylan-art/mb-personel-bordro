"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import { done, fail } from "@/lib/flash";
import { machineError } from "@/lib/machines";

const str = (f: FormData, k: string, max = 400) => String(f.get(k) ?? "").trim().slice(0, max);
const ID = /^[0-9a-f-]{36}$/;

async function need(level: number) {
  const s = await getSession();
  if ((s.modules.production ?? 0) < level && !(level <= 2 && s.logistics)) await fail(machineError("not_allowed"));
}
const reval = (id?: string) => { revalidatePath("/uretim/makineler"); if (id) revalidatePath(`/uretim/makineler/${id}`); };

export async function saveMachine(f: FormData) {
  await need(3);
  const p: Record<string, string | boolean> = {};
  for (const k of ["id", "name", "kind", "station_id", "asset_id", "brand_model", "daily_units", "tool_name", "tool_life_units", "maint_every_units", "next_maintenance", "note"]) p[k] = str(f, k, 500);
  if (f.has("is_active_set")) p.is_active = f.get("is_active") === "on";
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("prd_machine_save", { p });
  if (error) await fail(machineError(error.message));
  reval(data as string);
  if (!p.id) redirect(`/uretim/makineler/${data}`);
  await done("Makine kaydedildi.");
}

export async function enqueueJob(f: FormData) {
  await need(2);
  const id = str(f, "machine_id", 40);
  const no = Number(str(f, "job_no", 12).replace(/\D/g, ""));
  if (!ID.test(id) || !no) await fail("İş numarası yazın.");
  const units = Number(str(f, "units", 4)) || null;
  const supabase = await createClient();
  const { error } = await supabase.rpc("prd_machine_enqueue", { p_machine: id, p_job_no: no, p_units: units, p_date: str(f, "planned_date", 10) || null, p_note: str(f, "note", 300) || null });
  if (error) await fail(machineError(error.message));
  reval(id);
  await done(`İş #${no} kuyruğa eklendi.`);
}

export async function queueAction(f: FormData) {
  await need(2);
  const id = str(f, "id", 40);
  const action = str(f, "action", 10);
  const supabase = await createClient();
  const { error } = await supabase.rpc("prd_machine_queue_action", { p_id: id, p_action: action });
  if (error) await fail(machineError(error.message));
  reval(str(f, "machine_id", 40));
}

export async function machineEvent(f: FormData) {
  await need(2);
  const id = str(f, "machine_id", 40);
  const kind = str(f, "kind", 20);
  const supabase = await createClient();
  const { error } = await supabase.rpc("prd_machine_event", { p_machine: id, p_kind: kind, p_reason: str(f, "reason", 300) || null });
  if (error) await fail(machineError(error.message));
  reval(id);
  await done(kind === "tool_change" ? "Takım değişimi kaydedildi; sayaç sıfırlandı." : kind === "up" ? "Makine yeniden çalışıyor." : kind === "note" ? "Not eklendi." : "Duruş kaydı açıldı.");
}
