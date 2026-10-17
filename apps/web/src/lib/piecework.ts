import type { SupabaseClient } from "@supabase/supabase-js";

export type PcWorker = { id: string; kind: "internal" | "external"; employee_id: string | null; party_id: string | null; name: string; phone: string | null; doc_type: string; stopaj_pct: number; pay_side: "OFFICIAL" | "CASH"; pay_days: number; is_active: boolean; note: string | null };
export type PcRate = { id: string; lab_product_id: string | null; work_name: string; unit: string; price: number; worker_id: string | null; is_active: boolean };
export type PcEntry = {
  id: string; worker_id: string; work_date: string; period: string; job_id: string | null; lab_product_id: string | null; work_name: string; unit: string;
  qty: number; unit_price: number; amount: number; status: "pending" | "approved" | "rejected" | "posted"; note: string | null; reject_reason: string | null;
  stopaj_amount: number | null; net_amount: number | null; gross_amount: number | null; created_at: string;
  worker: string; kind: "internal" | "external"; job_no: string | null; product: string | null;
};

export const STATUS: Record<PcEntry["status"], { label: string; cls: string }> = {
  pending: { label: "Onay bekliyor", cls: "bg-warn-bg text-warn" },
  approved: { label: "Onaylı", cls: "bg-[#E7F1FB] text-brand-700" },
  posted: { label: "Aktarıldı", cls: "bg-ok-bg text-ok" },
  rejected: { label: "Reddedildi", cls: "bg-bad-bg text-bad" },
};
export const DOC: Record<string, string> = { none: "Belgesiz", gider_pusulasi: "Gider pusulası", serbest_meslek: "Serbest meslek makbuzu", fatura: "Fatura" };

export const nextMonth = (p: string) => {
  const [y, m] = p.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7);
};
export const prevMonth = (p: string) => {
  const [y, m] = p.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7);
};

/** Dönem aralığındaki parça başı kayıtları (usta, iş no, ürün adıyla) */
export async function loadPieceEntries(sb: SupabaseClient, fromPeriod: string, toPeriod: string, opts: { workerId?: string; status?: string } = {}) {
  let q = sb
    .from("pc_entries")
    .select("id, worker_id, work_date, period, job_id, lab_product_id, work_name, unit, qty, unit_price, amount, status, note, reject_reason, stopaj_amount, net_amount, gross_amount, created_at, pc_workers(name, kind), jobs(no), lab_products(name)")
    .gte("period", fromPeriod)
    .lte("period", toPeriod)
    .order("work_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(5000);
  if (opts.workerId) q = q.eq("worker_id", opts.workerId);
  if (opts.status) q = q.eq("status", opts.status);
  const { data, error } = await q;
  type Raw = Omit<PcEntry, "worker" | "kind" | "job_no" | "product"> & { pc_workers: { name: string; kind: PcEntry["kind"] } | null; jobs: { no: string | number } | null; lab_products: { name: string } | null };
  const rows: PcEntry[] = ((data ?? []) as unknown as Raw[]).map(({ pc_workers, jobs, lab_products, ...r }) => ({
    ...r, qty: Number(r.qty), unit_price: Number(r.unit_price), amount: Number(r.amount),
    worker: pc_workers?.name ?? "—", kind: pc_workers?.kind ?? "external", job_no: jobs?.no != null ? String(jobs.no) : null, product: lab_products?.name ?? null,
  }));
  return { rows, error: error?.message ?? null };
}

export function pcErr(m: string | null) {
  if (!m) return null;
  return /pc_|schema cache|does not exist/.test(m) ? "Supabase'de mbdental-parca-basi.sql çalıştırılmalı." : m;
}

/** Gruplama: anahtar → {adet, tutar, kayıt} */
export function groupBy<T>(rows: T[], key: (r: T) => string, qty: (r: T) => number, amount: (r: T) => number) {
  const m = new Map<string, { qty: number; amount: number; n: number }>();
  for (const r of rows) {
    const k = key(r);
    const g = m.get(k) ?? { qty: 0, amount: 0, n: 0 };
    g.qty += qty(r); g.amount += amount(r); g.n++;
    m.set(k, g);
  }
  return [...m.entries()].sort((a, b) => b[1].amount - a[1].amount);
}
