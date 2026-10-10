import { createClient } from "@/lib/supabase/server";
import type { AccountOption, CaseOption } from "./ShipmentForm";

/** Gönderi formu için portal hesapları ve açık vakalar */
export async function formOptions(): Promise<{ accounts: AccountOption[]; cases: CaseOption[] }> {
  const supabase = await createClient();
  const [{ data: acc }, { data: cs }] = await Promise.all([
    supabase.from("portal_accounts").select("id, name, company, type, country, city, phone, status").neq("status", "suspended").order("name"),
    supabase.from("portal_cases").select("id, no, account_id, patient_ref, status").not("status", "in", "(delivered,cancelled)").order("no", { ascending: false }).limit(500),
  ]);
  return {
    accounts: (acc ?? []).map((a) => ({ id: a.id, name: a.company ? `${a.company} (${a.name})` : a.name, type: a.type, country: a.country, city: a.city, phone: a.phone })),
    cases: (cs ?? []).map((c) => ({ id: c.id, no: c.no, account_id: c.account_id, patient_ref: c.patient_ref })),
  };
}

/** Portal hesap adları (liste ekranı için) */
export async function accountNames(ids: string[]): Promise<Map<string, string>> {
  const uniq = [...new Set(ids.filter(Boolean))];
  if (!uniq.length) return new Map();
  const supabase = await createClient();
  const { data } = await supabase.from("portal_accounts").select("id, name, company").in("id", uniq);
  return new Map((data ?? []).map((a) => [a.id as string, (a.company as string | null) || (a.name as string)]));
}
