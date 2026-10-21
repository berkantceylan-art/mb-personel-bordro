import "server-only";
import { createClient } from "@/lib/supabase/server";
import { allRows } from "@/lib/fetch-all";

/**
 * Müşteri alacak raporu: hekim / hastane bazında devir, dönem cirosu (teslim edilen işler), tahsilat, bakiye
 * ve kalan bakiyenin hangi aydan geldiği (ilk giren ilk kapanır: tahsilat önce en eski borcu kapatır).
 * Hekim cari ekranıyla aynı kural: borç = iç hesap açılışı + teslim edilen işler, alacak = tahsilatlar (iç hesaplı müşteride yalnız resmi olmayanlar).
 */
export type RecvRow = {
  id: string; name: string; kind: string | null; city: string | null; currency: string; active: boolean;
  opening: number;      // dönem başı bakiye (devir)
  sales: number;        // dönemde ciro
  paid: number;         // dönemde tahsilat
  balance: number;      // dönem sonu bakiye
  aging: Record<string, number>;   // "devir" | "YYYY-MM" → o aydan kalan alacak
  lastPay: string | null; lastJob: string | null;
};

export async function receivables(opts: { from: string; to: string; currency: string }) {
  const sb = await createClient();
  const [{ data: cs }, { data: jobs }, { data: pays }] = await Promise.all([
    sb.from("lab_customers").select("id, name, kind, city, currency, is_active, internal_book, internal_opening, internal_opening_date").order("name"),
    allRows<{ customer_id: string; total: number; delivered_at: string | null; in_date: string }>((a, b) => sb.from("jobs").select("customer_id, total, delivered_at, in_date").eq("status", "delivered").order("id").range(a, b)),
    allRows<{ customer_id: string; amount: number; paid_on: string; book?: string }>((a, b) => sb.from("lab_payments").select("customer_id, amount, paid_on, book").order("id").range(a, b)),
  ]);
  const custs = ((cs ?? []) as { id: string; name: string; kind: string | null; city: string | null; currency: string; is_active: boolean; internal_book?: boolean; internal_opening?: number; internal_opening_date?: string | null }[])
    .filter((c) => c.currency === opts.currency);
  const ids = new Set(custs.map((c) => c.id));
  type Ev = { d: string; amt: number };
  const debits = new Map<string, Ev[]>(), credits = new Map<string, Ev[]>();
  const push = (m: Map<string, Ev[]>, k: string, e: Ev) => { const a = m.get(k); if (a) a.push(e); else m.set(k, [e]); };
  for (const c of custs) if (c.internal_book && Number(c.internal_opening ?? 0)) push(debits, c.id, { d: c.internal_opening_date ?? "2000-01-01", amt: Number(c.internal_opening) });
  for (const j of jobs ?? []) if (ids.has(j.customer_id)) push(debits, j.customer_id, { d: (j.delivered_at ?? j.in_date).slice(0, 10), amt: Number(j.total) });
  const flagged = new Set(custs.filter((c) => c.internal_book).map((c) => c.id));
  for (const p of pays ?? []) if (ids.has(p.customer_id) && (!flagged.has(p.customer_id) || p.book !== "official")) push(credits, p.customer_id, { d: p.paid_on, amt: Number(p.amount) });

  const months: string[] = [];
  for (let d = new Date(`${opts.from.slice(0, 7)}-01T00:00:00Z`); d.toISOString().slice(0, 7) <= opts.to.slice(0, 7); d.setUTCMonth(d.getUTCMonth() + 1)) months.push(d.toISOString().slice(0, 7));

  const rows: RecvRow[] = custs.map((c) => {
    const dr = (debits.get(c.id) ?? []).filter((e) => e.d <= opts.to).sort((a, b) => a.d.localeCompare(b.d));
    const cr = (credits.get(c.id) ?? []).filter((e) => e.d <= opts.to).sort((a, b) => a.d.localeCompare(b.d));
    const sum = (a: Ev[]) => a.reduce((x, e) => x + e.amt, 0);
    const opening = sum(dr.filter((e) => e.d < opts.from)) - sum(cr.filter((e) => e.d < opts.from));
    const sales = sum(dr.filter((e) => e.d >= opts.from));
    const paid = sum(cr.filter((e) => e.d >= opts.from));
    const balance = opening + sales - paid;
    // FIFO: toplam tahsilat en eski borçlardan düşülür; kalan borç ayına yazılır
    let pool = sum(cr);
    const aging: Record<string, number> = {};
    for (const e of dr) {
      const used = Math.min(pool, e.amt); pool -= used;
      const left = e.amt - used;
      if (left > 0) { const k = e.d < opts.from ? "devir" : e.d.slice(0, 7); aging[k] = (aging[k] ?? 0) + left; }
    }
    if (pool > 0) aging["fazla"] = -pool;   // fazla tahsilat (avans)
    return { id: c.id, name: c.name, kind: c.kind, city: c.city, currency: c.currency, active: c.is_active, opening, sales, paid, balance, aging,
      lastPay: cr.length ? cr[cr.length - 1]!.d : null, lastJob: dr.length ? dr[dr.length - 1]!.d : null };
  });
  return { rows, months };
}

export const MONTH_TR = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];
export const monthLabel = (ym: string) => `${MONTH_TR[Number(ym.slice(5, 7)) - 1]} ${ym.slice(2, 4)}`;
