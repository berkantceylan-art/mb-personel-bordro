"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import { done, fail } from "@/lib/flash";
import { parseAmount } from "@/lib/fin";

const str = (f: FormData, k: string, max = 200) => String(f.get(k) ?? "").trim().slice(0, max);
const err = (m: string) => (/permission|policy/.test(m) ? "Konsolidasyon ayarı için finans (iptal ve ayar) yetkisi gerekir." : /cns_|group_company|schema cache/.test(m) ? "Supabase'de 20261229000000_reports_group.sql çalıştırılmalı." : m);
async function need() {
  const s = await getSession();
  if ((s.modules.finance ?? 0) < 3) await fail(err("permission"));
}
const reval = () => revalidatePath("/finans/konsolidasyon");

export async function saveEntity(f: FormData) {
  await need();
  const supabase = await createClient();
  const id = str(f, "id", 40);
  if (f.get("delete") === "1" && id) { await supabase.from("cns_entities").delete().eq("id", id); reval(); return; }
  const row = { name: str(f, "name", 120), country: str(f, "country", 60) || null, currency: str(f, "currency", 3) || "EUR", party_id: str(f, "party_id", 40) || null };
  if (!row.name) await fail("Şirket adı yazın.");
  const { error } = id ? await supabase.from("cns_entities").update(row).eq("id", id) : await supabase.from("cns_entities").insert(row);
  if (error) await fail(err(error.message));
  if (row.party_id) await supabase.from("fin_parties").update({ group_company: true }).eq("id", row.party_id);
  reval();
  await done("Grup şirketi kaydedildi.");
}

export async function setGroupParty(f: FormData) {
  await need();
  const supabase = await createClient();
  const { error } = await supabase.from("fin_parties").update({ group_company: f.get("on") === "1" }).eq("id", str(f, "party_id", 40));
  if (error) await fail(err(error.message));
  reval();
}

export async function saveEntry(f: FormData) {
  await need();
  const m = (k: string) => parseAmount(str(f, k, 20), true) ?? 0;
  const row = {
    entity_id: str(f, "entity_id", 40), period: str(f, "period", 7),
    revenue: m("revenue"), expense: m("expense"), cash: m("cash"), receivable: m("receivable"), payable: m("payable"),
    ic_revenue: m("ic_revenue"), ic_expense: m("ic_expense"), ic_receivable: m("ic_receivable"), ic_payable: m("ic_payable"),
    note: str(f, "note", 500) || null, updated_at: new Date().toISOString(),
  };
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(row.period)) await fail("Dönem geçersiz.");
  const supabase = await createClient();
  const { error } = await supabase.from("cns_entries").upsert(row);
  if (error) await fail(err(error.message));
  reval();
  await done(`${row.period} rakamları kaydedildi.`);
}
