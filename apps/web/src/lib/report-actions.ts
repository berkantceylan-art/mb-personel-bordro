"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import { DATASETS, presetRange, type DsKey, type ReportConfig } from "@/lib/report-defs";

type Row = Record<string, unknown>;
type Spec = { table: string; select: string; filter?: (q: any) => any; dims: Record<string, (r: Row) => string>; metrics: Record<string, (r: Row) => number>; currency?: (r: Row) => string; date: (r: Row, field: string) => string | null }; // eslint-disable-line @typescript-eslint/no-explicit-any

const STATUS: Record<string, string> = { open: "Açık", ready: "Hazır", tryin: "Provada", delivered: "Teslim edildi", cancelled: "İptal" };
const name = (x: unknown) => ((x as { name?: string } | null)?.name ?? "—");
const month = (d: string | null) => (d ? d.slice(0, 7) : "—");
const week = (d: string | null) => {
  if (!d) return "—";
  const t = new Date(`${d.slice(0, 10)}T12:00:00Z`);
  const dow = (t.getUTCDay() + 6) % 7;
  t.setUTCDate(t.getUTCDate() - dow);
  return t.toISOString().slice(0, 10);
};
const day = (r: Row, f: string) => { const v = r[f] as string | null; return v ? (v.length > 10 ? new Date(new Date(v).getTime() + 3 * 3600 * 1000).toISOString().slice(0, 10) : v) : null; };
const num = (v: unknown) => Number(v ?? 0) || 0;

const SPECS: Record<DsKey, Spec> = {
  jobs: {
    table: "jobs", select: "in_date, delivered_at, due_date, status, flow_stage, total, currency, doctor_name, lab_customers(name)",
    filter: (q) => q.neq("status", "cancelled"),
    dims: { customer: (r) => name(r.lab_customers), doctor: (r) => String(r.doctor_name || "—"), status: (r) => STATUS[String(r.status)] ?? String(r.status), stage: (r) => String(r.flow_stage ?? "—") },
    metrics: { count: () => 1, total: (r) => num(r.total) / 100 }, currency: (r) => String(r.currency), date: day,
  },
  items: {
    table: "job_items", select: "name, qty, amount, kind, jobs!inner(in_date, delivered_at, status, currency, lab_customers(name))",
    filter: (q) => q.neq("jobs.status", "cancelled"),
    dims: { product: (r) => String(r.name), customer: (r) => name((r.jobs as Row)?.lab_customers), kind: (r) => String(r.kind ?? "—") },
    metrics: { qty: (r) => num(r.qty), amount: (r) => num(r.amount) / 100, count: () => 1 }, currency: (r) => String((r.jobs as Row)?.currency ?? "TRY"),
    date: (r, f) => day(r.jobs as Row, f),
  },
  payments: {
    table: "lab_payments", select: "paid_on, amount, currency, method, book, lab_customers(name)",
    dims: { customer: (r) => name(r.lab_customers), method: (r) => String(r.method), book: (r) => String(r.book ?? "official") },
    metrics: { amount: (r) => num(r.amount) / 100, count: () => 1 }, currency: (r) => String(r.currency), date: day,
  },
  expenses: {
    table: "exp_claims", select: "expense_date, amount, currency, vendor, fin_categories(name), employees(first_name, last_name)",
    filter: (q) => q.eq("status", "posted"),
    dims: { category: (r) => name(r.fin_categories), employee: (r) => { const e = r.employees as { first_name: string; last_name: string } | null; return e ? `${e.first_name} ${e.last_name}` : "Şirket"; }, vendor: (r) => String(r.vendor || "—") },
    metrics: { amount: (r) => num(r.amount) / 100, count: () => 1 }, currency: (r) => String(r.currency), date: day,
  },
  invoices: {
    table: "inv_invoices", select: "invoice_date, direction, total, subtotal, vat_total, currency, fin_parties(name)",
    filter: (q) => q.eq("status", "posted"),
    dims: { party: (r) => name(r.fin_parties), direction: (r) => (r.direction === "sale" ? "Satış" : "Alış") },
    metrics: { total: (r) => num(r.total) / 100, subtotal: (r) => num(r.subtotal) / 100, vat: (r) => num(r.vat_total) / 100, count: () => 1 }, currency: (r) => String(r.currency), date: day,
  },
  complaints: {
    table: "qms_complaints", select: "received_at, category, severity, source, status, cost, lab_customers(name)",
    dims: { category: (r) => String(r.category), customer: (r) => name(r.lab_customers), severity: (r) => String(r.severity), source: (r) => String(r.source), status: (r) => String(r.status) },
    metrics: { count: () => 1, cost: (r) => num(r.cost) / 100 }, date: day,
  },
  remakes: {
    table: "prd_remakes", select: "created_at, reason, prd_stations!prd_remakes_station_id_fkey(name), employees(first_name, last_name)",
    dims: { reason: (r) => String(r.reason), station: (r) => name(r.prd_stations), employee: (r) => { const e = r.employees as { first_name: string; last_name: string } | null; return e ? `${e.first_name} ${e.last_name}` : "—"; } },
    metrics: { count: () => 1 }, date: day,
  },
  stock: {
    table: "stk_moves", select: "move_date, qty, unit_cost, kind, stk_items(name)",
    dims: { item: (r) => name(r.stk_items), kind: (r) => String(r.kind) },
    metrics: { qty: (r) => num(r.qty), value: (r) => (num(r.qty) * num(r.unit_cost)) / 100, count: () => 1 }, date: day,
  },
};

export type ReportResult = { ok: boolean; message?: string; rows?: { k1: string; k2: string | null; v: number }[]; total?: number; n?: number; truncated?: boolean; from?: string; to?: string };

export async function runReport(c: ReportConfig): Promise<ReportResult> {
  const s = await getSession();
  const def = DATASETS[c.ds];
  const spec = SPECS[c.ds];
  if (!def || !spec) return { ok: false, message: "Veri kümesi seçin." };
  if (s.role !== "owner" && !def.modules.some((m) => (s.modules[m] ?? 0) >= 1)) return { ok: false, message: "Bu veri kümesi için yetkiniz yok." };
  const dateField = def.dates.some(([k]) => k === c.date) ? c.date : def.dates[0]![0];
  const [from, to] = presetRange(c.preset, c.from, c.to);
  const dimFn = (k: string | undefined) => (!k ? null : k === "month" ? (r: Row) => month(spec.date(r, dateField)) : k === "week" ? (r: Row) => week(spec.date(r, dateField)) : spec.dims[k] ?? null);
  const d1 = dimFn(c.dim), d2 = dimFn(c.dim2);
  const mf = spec.metrics[c.metric] ?? Object.values(spec.metrics)[0]!;
  if (!d1) return { ok: false, message: "Kırılım seçin." };
  const supabase = await createClient();
  const nested = c.ds === "items";
  const col = nested ? `jobs.${dateField}` : dateField;
  const isTs = ["delivered_at", "received_at", "created_at"].includes(dateField);
  const rows: Row[] = [];
  for (let page = 0; page < 10; page++) {
    let q = supabase.from(spec.table).select(spec.select).gte(col, isTs ? `${from}T00:00:00+03:00` : from).lte(col, isTs ? `${to}T23:59:59+03:00` : to).range(page * 2000, page * 2000 + 1999);
    if (spec.filter) q = spec.filter(q);
    const { data, error } = await q;
    if (error) return { ok: false, message: /schema cache|does not exist/.test(error.message) ? "Bu veri kümesinin tablosu yok (ilgili SQL çalıştırılmamış)." : error.message };
    rows.push(...((data ?? []) as unknown as Row[]));
    if ((data ?? []).length < 2000) break;
  }
  const cur = def.money && spec.currency ? c.currency || "TRY" : null;
  const agg = new Map<string, { k1: string; k2: string | null; v: number }>();
  let n = 0;
  for (const r of rows) {
    if (cur && spec.currency!(r) !== cur) continue;
    const k1 = d1(r), k2 = d2 ? d2(r) : null;
    const key = `${k1}\u0000${k2 ?? ""}`;
    const x = agg.get(key) ?? { k1, k2, v: 0 };
    x.v += mf(r);
    agg.set(key, x);
    n++;
  }
  let out = [...agg.values()].map((x) => ({ ...x, v: Math.round(x.v * 100) / 100 }));
  const timeDim = c.dim === "month" || c.dim === "week";
  out.sort((a, b) => (timeDim ? a.k1.localeCompare(b.k1) : b.v - a.v));
  if (!timeDim && !d2 && c.top && out.length > c.top) {
    const rest = out.slice(c.top).reduce((a, x) => a + x.v, 0);
    out = [...out.slice(0, c.top), { k1: "Diğer", k2: null, v: Math.round(rest * 100) / 100 }];
  }
  return { ok: true, rows: out, total: Math.round(out.reduce((a, x) => a + x.v, 0) * 100) / 100, n, truncated: rows.length >= 20000, from, to };
}

export async function saveReport(input: { id?: string; name: string; config: ReportConfig; shared: boolean; delete?: boolean }): Promise<{ ok: boolean; message: string; id?: string }> {
  const supabase = await createClient();
  if (input.delete && input.id) {
    const { error } = await supabase.from("rpt_reports").delete().eq("id", input.id);
    revalidatePath("/rapor-tasarla");
    return error ? { ok: false, message: error.message } : { ok: true, message: "Rapor silindi." };
  }
  const row = { name: input.name.trim().slice(0, 120) || "Rapor", config: input.config, shared: !!input.shared, updated_at: new Date().toISOString() };
  const res = input.id ? await supabase.from("rpt_reports").update(row).eq("id", input.id).select("id").single() : await supabase.from("rpt_reports").insert(row).select("id").single();
  if (res.error) return { ok: false, message: /rpt_reports|schema cache/.test(res.error.message) ? "Supabase'de 20261229000000_reports_group.sql çalıştırılmalı." : res.error.message };
  revalidatePath("/rapor-tasarla");
  return { ok: true, message: "Rapor kaydedildi.", id: res.data.id as string };
}
