"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { done, fail } from "@/lib/flash";
import { parseMoney } from "@/lib/jobs";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const err = (m: string) => (/not_allowed/.test(m) ? "Bu işlem için yetkiniz yok." : /lab_customer_contract_save|lab_settings|schema cache/.test(m) ? "Supabase'de 20261216000000_pricing.sql çalıştırılmalı." : m);

/** Müşteri sözleşmesi: kredi limiti, vade, limit aşımında iş engeli, sözleşme tarihleri */
export async function saveContract(f: FormData) {
  const id = str(f, "customer_id");
  const limit = str(f, "credit_limit");
  const supabase = await createClient();
  const { error } = await supabase.rpc("lab_customer_contract_save", {
    p_customer: id,
    p: { credit_limit: limit ? String(parseMoney(limit) ?? "") : "", payment_term_days: str(f, "payment_term_days"), block_over_limit: f.get("block_over_limit") === "on", contract_start: str(f, "contract_start"), contract_end: str(f, "contract_end"), contract_note: str(f, "contract_note") },
  });
  if (error) await fail(err(error.message));
  revalidatePath(`/isler/hekimler/${id}`);
  await done("Sözleşme bilgileri kaydedildi.");
}

/** Kârlılık ayarları: işçilik saat maliyeti, genel gider oranı */
export async function saveLabSettings(f: FormData) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("lab_settings_save", { p_labor: parseMoney(str(f, "labor")) ?? 0, p_overhead: Number(str(f, "overhead").replace(",", ".")) || 0 });
  if (error) await fail(err(error.message));
  revalidatePath("/satis/karlilik");
  await done("Kârlılık ayarları kaydedildi.");
}
