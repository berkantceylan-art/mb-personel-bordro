import type { SupabaseClient } from "@supabase/supabase-js";

/** Müşteri × ürün fiyatı, son dönem satışı ve ürün maliyetinden kâr / zarar */
export type CmRow = {
  customerId: string; customer: string; kind: string; cur: string; city: string | null;
  productId: string; product: string;
  price: number | null;          // müşterinin para biriminde (kuruş / cent)
  priceTry: number | null;       // TL karşılığı (kuruş)
  source: "özel" | "liste" | "yok";
  qty: number; revTry: number; avgTry: number | null; last: string | null;
  effTry: number | null;         // fiilî ortalama satış (satış varsa) yoksa fiyat listesi
  cost: number | null; production: number | null;
  unitMargin: number | null;     // effTry − tam maliyet
  marginPct: number | null;
  profit: number | null;         // dönem kâr / zarar = (ortalama − tam maliyet) × adet
};
export type CmProduct = { id: string; name: string; cost: number | null; production: number | null; listTry: number | null; listEur: number | null };
export type CmData = { rows: CmRow[]; products: CmProduct[]; eur: number; usd: number; error: string | null };

type Raw = {
  eur: number; usd: number;
  customers: { id: string; name: string; kind: string; cur: string; city: string | null }[];
  prices: { c: string; p: string; t: number | null; e: number | null }[];
  sales: { c: string; p: string; cur: string; q: number; r: number; last: string }[];
};

export const MP = /metal.{0,3}porselen|metal.{0,3}seramik|ccm|c[ée]ramo.?m[ée]tal|m[ée]tallo.?c[ée]ram|porcelain.?fused/i;

export async function loadCustomerMargin(sb: SupabaseClient, months: number): Promise<CmData> {
  const from = new Date(Date.now() - months * 30.44 * 86400000).toISOString().slice(0, 10);
  const [{ data, error }, { data: costs, error: e2 }, { data: prods0 }] = await Promise.all([
    sb.rpc("prd_customer_margin", { p_from: from }),
    sb.rpc("prd_cost_list"),
    sb.from("lab_products").select("id, name, name_tr, price_try, price_eur"),
  ]);
  // name_tr sütunu yoksa onsuz
  const prods = prods0 ?? (await sb.from("lab_products").select("id, name, price_try, price_eur")).data;
  const err = error?.message ?? e2?.message ?? null;
  if (!data) return { rows: [], products: [], eur: 0, usd: 0, error: err };
  const raw = data as Raw;
  const eur = Number(raw.eur) || 0;
  const usd = Number(raw.usd) || 0;
  const rate = (cur: string) => (cur === "EUR" ? eur : cur === "USD" ? usd : 1);
  const costBy = new Map(((costs ?? []) as { id: string; total: number | null; production: number | null }[]).map((c) => [c.id, c]));
  const products: CmProduct[] = ((prods ?? []) as { id: string; name: string; name_tr?: string | null; price_try: number | null; price_eur: number | null }[]).map((p) => {
    const c = costBy.get(p.id);
    return { id: p.id, name: p.name_tr ? `${p.name_tr} (${p.name})` : p.name, cost: c?.total != null ? Number(c.total) : null, production: c?.production != null ? Number(c.production) : null, listTry: p.price_try, listEur: p.price_eur };
  });
  const prodBy = new Map(products.map((p) => [p.id, p]));
  const custBy = new Map(raw.customers.map((c) => [c.id, c]));
  const priceBy = new Map(raw.prices.map((p) => [`${p.c}|${p.p}`, p]));
  const sales = new Map<string, { q: number; rev: number; last: string }>();
  for (const s of raw.sales) {
    const k = `${s.c}|${s.p}`;
    const g = sales.get(k) ?? { q: 0, rev: 0, last: "" };
    g.q += Number(s.q); g.rev += Number(s.r) * rate(s.cur); if (s.last > g.last) g.last = s.last;
    sales.set(k, g);
  }
  const keys = new Set([...priceBy.keys(), ...sales.keys()]);
  const rows: CmRow[] = [];
  for (const k of keys) {
    const [cid, pid] = k.split("|") as [string, string];
    const cu = custBy.get(cid);
    const pr = prodBy.get(pid);
    if (!cu || !pr) continue;
    const sp = priceBy.get(k);
    const isEur = cu.cur === "EUR";
    const special = isEur ? sp?.e ?? null : sp?.t ?? null;
    const list = isEur ? pr.listEur : pr.listTry;
    // USD müşteride TL fiyat geçerli (USD fiyat listesi yok)
    const price = special ?? list ?? null;
    const priceCur = cu.cur === "USD" ? "TRY" : cu.cur;
    const priceTry = price != null ? Math.round(price * rate(priceCur)) : null;
    const s = sales.get(k);
    const qty = s?.q ?? 0;
    const revTry = Math.round(s?.rev ?? 0);
    const avgTry = qty ? Math.round(revTry / qty) : null;
    const effTry = avgTry ?? priceTry;
    const unitMargin = effTry != null && pr.cost != null ? effTry - pr.cost : null;
    rows.push({
      customerId: cid, customer: cu.name, kind: cu.kind, cur: cu.cur, city: cu.city, productId: pid, product: pr.name,
      price, priceTry, source: special != null ? "özel" : list != null ? "liste" : "yok",
      qty, revTry, avgTry, last: s?.last ?? null, effTry, cost: pr.cost, production: pr.production, unitMargin,
      marginPct: unitMargin != null && effTry ? Math.round((1000 * unitMargin) / effTry) / 10 : null,
      profit: unitMargin != null && qty ? unitMargin * qty : null,
    });
  }
  return { rows, products, eur, usd, error: err };
}

/** Ürün bazında özet */
export function productSummary(rows: CmRow[], products: CmProduct[]) {
  const by = new Map<string, CmRow[]>();
  for (const r of rows) by.set(r.productId, [...(by.get(r.productId) ?? []), r]);
  return products
    .filter((p) => by.has(p.id))
    .map((p) => {
      const rs = by.get(p.id)!;
      const qty = rs.reduce((t, r) => t + r.qty, 0);
      const rev = rs.reduce((t, r) => t + r.revTry, 0);
      const avg = qty ? Math.round(rev / qty) : null;
      const profit = p.cost != null && qty ? rev - p.cost * qty : null;
      const losers = rs.filter((r) => r.unitMargin != null && r.unitMargin < 0).length;
      const prices = rs.map((r) => r.effTry).filter((x): x is number => x != null);
      return { ...p, customers: rs.length, qty, rev, avg, profit, losers, min: prices.length ? Math.min(...prices) : null, max: prices.length ? Math.max(...prices) : null };
    })
    .sort((a, b) => b.rev - a.rev);
}
