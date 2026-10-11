import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Item, Warehouse } from "@/lib/stock";

export type ItemRow = Item & { qty: number; avg_cost: number; value: number; category: string | null };

export async function loadItems(): Promise<{ rows: ItemRow[]; error: string | null }> {
  const supabase = await createClient();
  const [{ data, error }, { data: tot }, { data: cats }] = await Promise.all([
    supabase.from("stk_items").select("*").order("name").limit(5000),
    supabase.from("stk_item_totals").select("item_id, qty, avg_cost, value").limit(5000),
    supabase.from("stk_categories").select("id, name"),
  ]);
  const tmap = new Map((tot ?? []).map((t) => [t.item_id as string, t]));
  const cmap = new Map((cats ?? []).map((c) => [c.id as string, c.name as string]));
  return {
    rows: ((data ?? []) as Item[]).map((i) => ({ ...i, qty: Number(tmap.get(i.id)?.qty ?? 0), avg_cost: Number(tmap.get(i.id)?.avg_cost ?? 0), value: Number(tmap.get(i.id)?.value ?? 0), category: i.category_id ? cmap.get(i.category_id) ?? null : null })),
    error: error?.message ?? null,
  };
}

export async function loadWarehouses(): Promise<Warehouse[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("stk_warehouses").select("*").order("is_default", { ascending: false }).order("name");
  return (data ?? []) as Warehouse[];
}

export async function loadCategories(): Promise<{ id: string; name: string }[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("stk_categories").select("id, name").order("sort").order("name");
  return (data ?? []) as { id: string; name: string }[];
}

export type StockRow = { item_id: string; warehouse_id: string; lot_no: string | null; expiry_date: string | null; qty: number };
export async function loadStock(filter: { item?: string; warehouse?: string } = {}): Promise<StockRow[]> {
  const supabase = await createClient();
  let q = supabase.from("stk_stock").select("item_id, warehouse_id, lot_no, expiry_date, qty").limit(10000);
  if (filter.item) q = q.eq("item_id", filter.item);
  if (filter.warehouse) q = q.eq("warehouse_id", filter.warehouse);
  const { data } = await q;
  return ((data ?? []) as StockRow[]).map((r) => ({ ...r, qty: Number(r.qty) }));
}
