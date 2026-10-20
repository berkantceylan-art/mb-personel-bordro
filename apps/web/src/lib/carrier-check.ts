import "server-only";
import { createClient } from "@/lib/supabase/server";
import { allRows } from "@/lib/fetch-all";

export type CItem = { id: string; invoice_id: string; awb: string; ship_date: string | null; dest: string | null; dest_country: string | null; product: string | null;
  weight: number | null; weight_basis: string | null; base_amount: number; extras: { name: string; amount: number }[]; extras_total: number; total: number;
  recipient: string | null; recipient_company: string | null; shipment_id: string | null; customer_id: string | null; disputed: boolean; note: string | null;
  carrier_invoices: { carrier: string; invoice_no: string; invoice_date: string | null; eur_rate: number | null } | null; lab_customers: { name: string } | null };
export type Flag = "dup" | "noship" | "nocust" | "premium" | "high";
export const FLAG_LABEL: Record<Flag, string> = {
  dup: "Mükerrer faturalanmış", noship: "Konşimento listesinde / kargo kaydında yok", nocust: "Hekim bulunamadı",
  premium: "Ek hizmet (saatli teslim, ikamet, adres düzeltme…)", high: "Ortalamanın üstünde",
};
export const PREMIUM = /12:00|09:00|10:30|IKAMET|İKAMET|RESIDENTIAL|ADRES D[UÜ]ZELT|ADDRESS CORR|UZAK B[OÖ]LGE|REMOTE|EXTENDED AREA|OVERSIZE|A[SŞ]IRI|SATURDAY|CUMARTES|KOL[Iİ] [Iİ]ADE|RETURN|SIGNATURE|[Iİ]MZA/i;

export async function loadCarrierItems(from: string, invoiceId?: string, carrier?: string) {
  const sb = await createClient();
  const sel = "id, invoice_id, awb, ship_date, dest, dest_country, product, weight, weight_basis, base_amount, extras, extras_total, total, recipient, recipient_company, shipment_id, customer_id, disputed, note, carrier_invoices!inner(carrier, invoice_no, invoice_date, eur_rate), lab_customers(name)";
  const r = await allRows<CItem>((a, b) => {
    const q = sb.from("carrier_invoice_items").select(sel);
    const q2 = invoiceId ? q.eq("invoice_id", invoiceId) : q.or(`invoice_date.gte.${from},invoice_date.is.null`, { referencedTable: "carrier_invoices" });
    return (carrier ? q2.eq("carrier_invoices.carrier", carrier) : q2).order("id").range(a, b);
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
  // konşimento raporunda olanlar "gönderi kaydı var" sayılır
  const inReport = new Set<string>();
  for (let k = 0; k < awbs.length; k += 300) {
    const { data } = await sb.from("carrier_shipments").select("awb").in("awb", awbs.slice(k, k + 300));
    for (const d of (data ?? []) as { awb: string }[]) inReport.add(d.awb);
  }
  // kg başı ortanca (taşıyıcı + ülke)
  const groups = new Map<string, number[]>();
  for (const i of items) if (i.weight && i.weight > 0) { const k = `${i.carrier_invoices?.carrier}|${i.dest_country ?? i.dest}`; (groups.get(k) ?? groups.set(k, []).get(k)!).push(i.total / i.weight); }
  const median = new Map<string, number>();
  for (const [k, v] of groups) if (v.length >= 4) { const s = [...v].sort((a, b) => a - b); median.set(k, s[Math.floor(s.length / 2)]!); }
  return items.map((i) => {
    const f: Flag[] = [];
    if ((counts.get(i.awb) ?? 1) > 1) f.push("dup");
    if (!i.shipment_id && !inReport.has(i.awb)) f.push("noship");
    if (!i.customer_id) f.push("nocust");
    if (i.extras.some((x) => PREMIUM.test(x.name))) f.push("premium");
    const m = median.get(`${i.carrier_invoices?.carrier}|${i.dest_country ?? i.dest}`);
    if (m && i.weight && i.total / i.weight > m * 1.3) f.push("high");
    return { ...i, flags: f };
  });
}

export type CShip = { id: string; carrier: string; awb: string; ship_date: string | null; direction: string | null; service: string | null; party_company: string | null;
  party_country: string | null; weight: number | null; vol_weight: number | null; est_amount: number | null; est_currency: string | null; account: string | null; status: string | null;
  customer_id: string | null; lab_customers: { name: string } | null };

/** DHL tartı kuralı: büyük olan (gerçek / hacim) ağırlık, 0,5 kg'a yukarı yuvarlanır */
export const billable = (w: number | null, v: number | null) => { const m = Math.max(w ?? 0, v ?? 0); return m > 0 ? Math.ceil(m * 2 - 1e-9) / 2 : null; };

export async function loadCarrierShipments(from: string, carrier: string) {
  const sb = await createClient();
  return allRows<CShip>((a, b) => sb.from("carrier_shipments").select("id, carrier, awb, ship_date, direction, service, party_company, party_country, weight, vol_weight, est_amount, est_currency, account, status, customer_id, lab_customers(name)")
    .eq("carrier", carrier).gte("ship_date", from).order("id").range(a, b));
}
