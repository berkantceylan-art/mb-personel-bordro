"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { done, fail } from "@/lib/flash";
import { parseAmount } from "@/lib/fin";

const str = (f: FormData, k: string, max = 200) => String(f.get(k) ?? "").trim().slice(0, max);
const err = (m: string) =>
  /not_allowed|permission/.test(m) ? "Bu adımda onay yetkiniz yok."
  : /own_request/.test(m) ? "Kendi talebinizi onaylayamazsınız."
  : /already_approved_step/.test(m) ? "Bu talepte zaten bir adımı onayladınız; sonraki adımı başka biri onaylamalı."
  : /note_required/.test(m) ? "Ret için neden yazın."
  : /not_pending/.test(m) ? "Bu talep artık beklemede değil."
  : /steps_required/.test(m) ? "En az bir onay adımı ekleyin."
  : /name_required/.test(m) ? "Akış adı yazın."
  : /apr_|schema cache/.test(m) ? "Supabase'de 20261226000000_approvals.sql çalıştırılmalı."
  : m;

export async function decideApproval(f: FormData) {
  const supabase = await createClient();
  const decision = str(f, "decision", 10) === "reject" ? "reject" : "approve";
  const { data, error } = await supabase.rpc("apr_decide", { p_request: str(f, "id", 40), p_decision: decision, p_note: str(f, "note", 500) || null });
  if (error) await fail(err(error.message));
  revalidatePath("/onaylar");
  revalidatePath("/masraf");
  revalidatePath("/alis/siparisler", "layout");
  await done(data === "next" ? "Onaylandı; sonraki adıma geçti." : data === "approved" ? "Onaylandı; akış tamamlandı." : "Reddedildi.");
}

export type StepInput = { approver_kind: string; user_id?: string; module?: string; level?: number; label?: string };

export async function saveFlow(input: { id?: string; entity: string; name: string; min_amount: string; max_amount: string; category_id: string; priority: string; is_active: boolean; steps: StepInput[]; delete?: boolean }): Promise<{ ok: boolean; message: string }> {
  const supabase = await createClient();
  const money = (v: string) => { const n = parseAmount(v); return n === null ? "" : String(n); };
  const { error } = await supabase.rpc("apr_flow_save", { p: { ...input, min_amount: money(input.min_amount), max_amount: money(input.max_amount) } });
  if (error) return { ok: false, message: err(error.message) };
  revalidatePath("/yonetim/onay-akislari");
  return { ok: true, message: input.delete ? "Akış silindi." : "Akış kaydedildi." };
}
