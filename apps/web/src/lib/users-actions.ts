"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { done, fail } from "@/lib/flash";

import { MODS, TEMPLATES } from "@/lib/users";

function usersError(m: string) {
  if (/owner_full/.test(m)) return "Firma sahibinin yetkileri her zaman tamdır.";
  if (/self_lockout/.test(m)) return "Kendi kullanıcı yönetimi yetkinizi düşüremezsiniz.";
  if (/not_allowed/.test(m)) return "Yetki atamak için Kullanıcılar modülünde “Yönetir” seviyesi gerekir.";
  if (/function set_module_levels|users_overview|schema cache/.test(m)) return "Supabase'de 20261208000000_users_admin.sql çalıştırılmalı.";
  return m;
}

export async function saveModuleLevels(form: FormData) {
  const user = String(form.get("user_id") ?? "");
  const tpl = String(form.get("template") ?? "");
  let levels: Record<string, number | null>;
  if (tpl && TEMPLATES[tpl]) levels = TEMPLATES[tpl].levels as Record<string, number | null>;
  else levels = Object.fromEntries(MODS.map((m) => { const v = String(form.get(m) ?? "d"); return [m, v === "d" ? null : Math.min(3, Math.max(0, Number(v)))]; }));
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_module_levels", { p_user: user, p_levels: levels });
  if (error) await fail(usersError(error.message));
  revalidatePath("/yonetim/yetkiler");
  await done(tpl ? `“${TEMPLATES[tpl]?.label}” şablonu uygulandı. Kullanıcı bir sonraki sayfa açışında yeni yetkileri görür.` : "Yetkiler kaydedildi.");
}
