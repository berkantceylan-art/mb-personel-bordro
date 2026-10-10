import { createClient } from "@/lib/supabase/server";
import type { CustomerOpt, ProductOpt } from "./JobEditor";

/** İş kayıt ekranının seçenekleri: hekimler (doktorlarıyla), ürünler, teslim şekilleri, prova türleri, sıradaki no */
export async function editorOptions() {
  const supabase = await createClient();
  const [{ data: cs, error }, { data: ds }, { data: ps }, { data: os }, { data: last }] = await Promise.all([
    supabase.from("lab_customers").select("id, name, currency, discount_pct, is_active").order("name"),
    supabase.from("lab_customer_doctors").select("customer_id, name").order("name"),
    supabase.from("lab_products").select("id, name, material, price_try, price_eur, is_active, sort").eq("is_active", true).order("sort").order("name"),
    supabase.from("lab_options").select("kind, value, sort").order("sort").order("value"),
    supabase.from("jobs").select("no").order("no", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const docs = new Map<string, string[]>();
  for (const d of ds ?? []) docs.set(d.customer_id as string, [...(docs.get(d.customer_id as string) ?? []), d.name as string]);
  const customers: CustomerOpt[] = (cs ?? []).filter((c) => c.is_active).map((c) => ({ id: c.id, name: c.name, currency: c.currency, discount_pct: Number(c.discount_pct ?? 0), doctors: docs.get(c.id) ?? [] }));
  const products: ProductOpt[] = (ps ?? []).map((p) => ({ id: p.id, name: p.name, material: p.material, price_try: p.price_try, price_eur: p.price_eur }));
  const delivery = (os ?? []).filter((o) => o.kind === "delivery").map((o) => o.value as string);
  const tryins = (os ?? []).filter((o) => o.kind === "tryin").map((o) => o.value as string);
  return { customers, products, delivery, tryins, nextNo: last?.no ? Number(last.no) + 1 : 1, missing: !!error };
}
