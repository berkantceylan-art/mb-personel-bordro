"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import { done, fail } from "@/lib/flash";

/** Seçilen önerilerden tedarikçi başına taslak satın alma siparişi */
export async function ordersFromForecast(f: FormData) {
  const s = await getSession();
  if ((s.modules.purchases ?? 0) < 2) await fail("Satın alma siparişi için alış yetkisi gerekir.");
  const picks = f.getAll("pick").map(String).filter((x) => /^[0-9a-f-]{36}$/.test(x));
  if (!picks.length) await fail("Malzeme seçin.");
  const supabase = await createClient();
  const { data: items } = await supabase.from("stk_items").select("id, name, unit, purchase_price, purchase_currency, vat_rate, supplier_party_id").in("id", picks);
  const bySup = new Map<string, { item_id: string; name: string; qty: number; unit: string; unit_price: number; vat_rate: number }[]>();
  const noSup: string[] = [];
  for (const it of (items ?? []) as { id: string; name: string; unit: string; purchase_price: number | null; purchase_currency: string | null; vat_rate: number | null; supplier_party_id: string | null }[]) {
    const qty = Number(String(f.get(`q_${it.id}`) ?? "0").replace(",", "."));
    if (!(qty > 0)) continue;
    if (!it.supplier_party_id) { noSup.push(it.name); continue; }
    const l = bySup.get(it.supplier_party_id) ?? [];
    l.push({ item_id: it.id, name: it.name, qty, unit: it.unit, unit_price: Number(it.purchase_price ?? 0), vat_rate: Number(it.vat_rate ?? 20) });
    bySup.set(it.supplier_party_id, l);
  }
  let n = 0;
  let last: string | null = null;
  for (const [party, lines] of bySup) {
    const { data, error } = await supabase.rpc("pur_order_save", { p: { party_id: party, lines, note: "Talep tahmininden oluşturuldu" } });
    if (error) await fail(error.message);
    n++; last = data as string;
  }
  revalidatePath("/alis/siparisler", "layout");
  if (n === 1 && last && !noSup.length) redirect(`/alis/siparisler/${last}`);
  await done(`${n} taslak sipariş oluşturuldu${noSup.length ? `; tedarikçisi tanımsız: ${noSup.slice(0, 5).join(", ")}` : ""}. Alış > Satın alma siparişleri'nden kontrol edip onaya gönderin.`);
}
