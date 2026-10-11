"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import { done, fail } from "@/lib/flash";
import { parseAmount } from "@/lib/fin";

const str = (f: FormData, k: string, max = 200) => String(f.get(k) ?? "").trim().slice(0, max);
const err = (m: string) =>
  /not_allowed|permission/.test(m) ? "Prim için üretim (tam) ya da bordro yetkisi gerekir."
  : /own_line/.test(m) ? "Kendi prim satırınızı düzeltemezsiniz."
  : /already_posted/.test(m) ? "Bu dönemin primi bordroya aktarılmış; değiştirilemez."
  : /name_required/.test(m) ? "Kural adı yazın."
  : /bad_period/.test(m) ? "Dönem geçersiz."
  : /prd_bonus|schema cache/.test(m) ? "Supabase'de 20261224000000_bonus.sql çalıştırılmalı."
  : m;

async function allowed() {
  const s = await getSession();
  if ((s.modules.production ?? 0) < 3 && (s.modules.payroll ?? 0) < 2 && !["owner", "accountant"].includes(s.role)) await fail(err("not_allowed"));
  return s;
}

async function payroll() {
  const s = await getSession();
  if ((s.modules.payroll ?? 0) < 2 && !["owner", "accountant"].includes(s.role)) await fail("Prim kuralı ve düzeltme için bordro yetkisi gerekir.");
}

export async function saveBonusRule(f: FormData) {
  await payroll();
  const money = (k: string) => { const v = parseAmount(str(f, k, 20)); return v === null ? "" : String(v); };
  const p = {
    id: str(f, "id", 40), name: str(f, "name", 80), employee_id: str(f, "employee_id", 40),
    unit_amount: money("unit_amount"), free_units: str(f, "free_units", 6), target_units: str(f, "target_units", 6), target_bonus: money("target_bonus"),
    reject_penalty: money("reject_penalty"), min_on_time_pct: str(f, "min_on_time_pct", 3), on_time_factor: str(f, "on_time_factor", 4).replace(",", "."),
    max_amount: money("max_amount"), is_active: f.get("is_active") !== null || !f.has("is_active_set"), delete: f.get("delete") === "1",
  };
  const supabase = await createClient();
  const { error } = await supabase.rpc("prd_bonus_rule_save", { p });
  if (error) await fail(err(error.message));
  revalidatePath("/uretim/prim");
  await done(p.delete ? "Kural silindi." : "Prim kuralı kaydedildi.");
}

export async function computeBonus(f: FormData) {
  await allowed();
  const period = str(f, "period", 7);
  const supabase = await createClient();
  const { error } = await supabase.rpc("prd_bonus_compute", { p_period: period });
  if (error) await fail(err(error.message));
  revalidatePath("/uretim/prim");
  await done(`${period} primi hesaplandı. Kontrol edip bordroya aktarın.`);
}

export async function adjustBonus(f: FormData) {
  await payroll();
  const supabase = await createClient();
  const { error } = await supabase.rpc("prd_bonus_adjust", { p_line: str(f, "id", 40), p_adjust: parseAmount(str(f, "adjust", 20), true) ?? 0 });
  if (error) await fail(err(error.message));
  revalidatePath("/uretim/prim");
}

export async function postBonus(f: FormData) {
  const s = await getSession();
  if ((s.modules.payroll ?? 0) < 2 && !["owner", "accountant"].includes(s.role)) await fail("Bordroya aktarmak için bordro yetkisi gerekir.");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("prd_bonus_post", { p_run: str(f, "id", 40) });
  if (error) await fail(err(error.message));
  revalidatePath("/uretim/prim");
  await done(`${data ?? 0} personelin carisine prim hareketi işlendi; bordroda hakediş olarak görünür.`);
}
