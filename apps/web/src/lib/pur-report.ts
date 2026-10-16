/** Satın alma raporu tipleri ve dönem yardımcıları */
export type PurReport = {
  kpi: { po_n: number; po_total: number; inv_n: number; inv_total: number; inv_net: number; suppliers: number; approval_hours: number | null; lead_days: number | null; on_time_pct: number | null; late_open: number; req_to_po_days: number | null; rfq_n: number; rfq_saving: number; short_closed: number };
  by_supplier: { party_id: string; name: string; po_n: number; po_total: number; inv_total: number }[];
  by_category: { category_id: string | null; name: string; total: number }[];
  by_item: ReportItem[];
  price_up: ReportItem[];
  monthly: { month: string; ordered: number; invoiced: number }[];
};
export type ReportItem = { name: string; unit: string; qty: number; total: number; avg_price: number; min_price: number; max_price: number; first_price: number; last_price: number; suppliers: number; n: number };

export function reportPeriod(sp: { bas?: string; bit?: string; d?: string }) {
  const ok = (v?: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
  const today = new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10);
  const y = today.slice(0, 4), m = today.slice(0, 7);
  const presets: Record<string, [string, string]> = {
    ay: [`${m}-01`, today],
    "3ay": [new Date(Date.parse(today) - 90 * 864e5).toISOString().slice(0, 10), today],
    yil: [`${y}-01-01`, today],
    "12ay": [new Date(Date.parse(today) - 365 * 864e5).toISOString().slice(0, 10), today],
  };
  const p = sp.d && presets[sp.d] ? sp.d : ok(sp.bas) ? "" : "yil";
  const [from, to] = p ? presets[p] : [ok(sp.bas)!, ok(sp.bit) ?? today];
  return { from, to, preset: p };
}

export const changePct = (a: number, b: number) => (a > 0 ? Math.round(((b - a) / a) * 1000) / 10 : 0);
