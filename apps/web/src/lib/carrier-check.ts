import "server-only";
import { createClient } from "@/lib/supabase/server";
import { allRows } from "@/lib/fetch-all";

export type CItem = { id: string; invoice_id: string; awb: string; ship_date: string | null; dest: string | null; dest_country: string | null; product: string | null;
  weight: number | null; weight_basis: string | null; base_amount: number; extras: { name: string; amount: number }[]; extras_total: number; total: number;
  recipient: string | null; recipient_company: string | null; shipment_id: string | null; customer_id: string | null; disputed: boolean; note: string | null;
  carrier_invoices: { carrier: string; invoice_no: string; invoice_date: string | null } | null; lab_customers: { name: string } | null };
export type Flag = "dup" | "noship" | "nocust" | "measured" | "premium" | "high";
export const FLAG_LABEL: Record<Flag, string> = {
  dup: "Mükerrer faturalanmış", noship: "Gönderi kaydı yok", nocust: "Hekim bulunamadı", measured: "Kargo firması tarttı / ölçtü",
  premium: "Ek hizmet (saatli teslim, ikamet, adres düzeltme…)", high: "Ortalamanın üstünde",
};
export const PREMIUM = /12:00|09:00|10:30|IKAMET|İKAMET|RESIDENTIAL|ADRES D[UÜ]ZELT|ADDRESS CORR|UZAK B[OÖ]LGE|REMOTE|EXTENDED AREA|OVERSIZE|A[SŞ]IRI|SATURDAY|CUMARTES|KOL[Iİ] [Iİ]ADE|RETURN|SIGNATURE|[Iİ]MZA/i;

export async function loadCarrierItems(from: string, invoiceId?: string) {
  const sb = await createClient();
  const sel = "id, invoice_id, awb, ship_date, dest, dest_country, product, weight, weight_basis, base_amount, extras, extras_total, total, recipient, recipient_company, shipment_id, customer_id, disputed, note, carrier_invoices!inner(carrier, invoice_no, invoice_date), lab_customers(name)";
  const r = await allRows<CItem>((a, b) => {
    const q = sb.from("carrier_invoice_items").select(sel);
    return (invoiceId ? q.eq("invoice_id", invoiceId) : q.gte("carrier_invoices.invoice_date", from)).order("id").range(a, b);
  });
  return r;
}

/** Her satır için uyarılar: mükerrer, gönderi / hekim yok, firma tartısı, ek hizmet, aynı ülkede kg başı ortalamanın %30 üstü */
export async function flagItems(items: CItem[]) {
  const sb = await createClient();
  const awbs = [...new Set(items.map((i) => i.awb))];
  const counts = new Map<string, number>();
  for (let k = 0; k < awbs.length; k += 300) {
    const { data } = await sb.from("carrier_invoice_items").select("awb, invoice_id").in("awb", awbs.slice(k, k + 300));
    const seen = new Map<string, Set<string>>();
    for (const d of (data ?? []) as { awb: string; invoice_id: string }[]) (seen.get(d.awb) ?? seen.set(d.awb, new Set()).get(d.awb)!).add(d.invoice_id);
    for (const [a, s] of seen) counts.set(a, s.size);
  }
  // kg başı ortanca (taşıyıcı + ülke)
  const groups = new Map<string, number[]>();
  for (const i of items) if (i.weight && i.weight > 0) { const k = `${i.carrier_invoices?.carrier}|${i.dest_country ?? i.dest}`; (groups.get(k) ?? groups.set(k, []).get(k)!).push(i.total / i.weight); }
  const median = new Map<string, number>();
  for (const [k, v] of groups) if (v.length >= 4) { const s = [...v].sort((a, b) => a - b); median.set(k, s[Math.floor(s.length / 2)]!); }
  return items.map((i) => {
    const f: Flag[] = [];
    if ((counts.get(i.awb) ?? 1) > 1) f.push("dup");
    if (!i.shipment_id) f.push("noship");
    if (!i.customer_id) f.push("nocust");
    if (i.weight_basis === "B" || i.weight_basis === "W") f.push("measured");
    if (i.extras.some((x) => PREMIUM.test(x.name))) f.push("premium");
    const m = median.get(`${i.carrier_invoices?.carrier}|${i.dest_country ?? i.dest}`);
    if (m && i.weight && i.total / i.weight > m * 1.3) f.push("high");
    return { ...i, flags: f };
  });
}
