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
