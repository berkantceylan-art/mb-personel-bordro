"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type FixState = { ok: boolean; message: string };
const err = (m: string) => (/not_allowed/.test(m) ? "Yetkiniz yok." : /bad_employee/.test(m) ? "Personel seçin." : /bad_stage/.test(m) ? "Aşama seçin." : /note_required/.test(m) ? "Not yazın." : /adm_job_fix|does not exist/.test(m) ? "Supabase'de 20270126000000_admin_flow.sql çalıştırılmalı." : m);

/** İş akışı denetimi: sorumlu ata / aşamaya taşı / not */
export async function jobFix(_: FixState | null, f: FormData): Promise<FixState> {
  const action = String(f.get("action") ?? "");
  const supabase = await createClient();
  const { error } = await supabase.rpc("adm_job_fix", {
    p_job: String(f.get("job") ?? ""), p_action: action, p_stage: String(f.get("stage") ?? "") || null,
    p_employee: String(f.get("employee") ?? "") || null, p_note: String(f.get("note") ?? "").slice(0, 300) || null,
  });
  if (error) return { ok: false, message: err(error.message) };
  revalidatePath("/yonetim/is-akisi");
  revalidatePath("/yonetim/kontrol");
  return { ok: true, message: action === "assign" ? "Sorumlu atandı, kişiye bildirim gitti." : action === "stage" ? "Aşama değişti." : "Not eklendi." };
}

const terr = (m: string) => (/not_allowed/.test(m) ? "Yetkiniz yok." : /bad_assignee/.test(m) ? "Sorumlu seçin." : /title_required/.test(m) ? "Görev başlığı yazın." : /admin_task|does not exist/.test(m) ? "Supabase'de 20270127000000_admin_pulse.sql çalıştırılmalı." : m);

/** Kontrol Merkezi bulgusunu bir kullanıcıya görev olarak ata (kişiye bildirim gider) */
export async function taskCreate(_: FixState | null, f: FormData): Promise<FixState> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_task_create", {
    p_title: String(f.get("title") ?? ""), p_assignee: String(f.get("assignee") ?? "") || null, p_due: String(f.get("due") ?? "") || null,
    p_note: String(f.get("note") ?? "") || null, p_link: String(f.get("link") ?? "") || null, p_rule: String(f.get("rule") ?? "") || null,
  });
  if (error) return { ok: false, message: terr(error.message) };
  revalidatePath("/yonetim/kontrol");
  return { ok: true, message: "Görev atandı, kişiye bildirim gitti." };
}

/** Görevi tamamla / yeniden aç / kapat */
export async function taskSet(_: FixState | null, f: FormData): Promise<FixState> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_task_set", { p_id: String(f.get("id") ?? ""), p_status: String(f.get("status") ?? ""), p_note: String(f.get("note") ?? "") || null });
  if (error) return { ok: false, message: terr(error.message) };
  revalidatePath("/yonetim/kontrol");
  revalidatePath("/benim/gorevler");
  return { ok: true, message: "Güncellendi." };
}
