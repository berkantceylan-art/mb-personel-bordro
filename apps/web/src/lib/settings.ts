import { settingsFromRow, type CompanySettings } from "@mb/core";
import type { createClient } from "@/lib/supabase/server";

type SB = Awaited<ReturnType<typeof createClient>>;

/** Şirketin mevzuat ayarları (satır yoksa varsayılanlar) */
export async function getCompanySettings(supabase: SB): Promise<CompanySettings> {
  const { data } = await supabase.from("company_settings").select("*").maybeSingle();
  return settingsFromRow(data);
}
