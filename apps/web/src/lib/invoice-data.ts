import "server-only";
import { createClient } from "@/lib/supabase/server";
import { latestRates, loadCategories } from "@/lib/fin-data";
import type { Company, Direction, InvLine, Invoice } from "@/lib/invoice";
import { buildUbl } from "@/lib/ubl";

export type FormParty = { id: string; name: string; currency: string; tax_no: string | null; kind: string; is_einvoice: boolean; country: string; payment_term_days: number; lab: boolean };
export type FormItem = { id: string; code: string; barcode: string | null; name: string; unit: string; kind: string; sale_price: number | null; sale_currency: string; purchase_price: number | null; purchase_currency: string; vat_rate: number; qty: number };
export type FormProduct = { id: string; name: string; code: string | null; price_try: number | null; price_eur: number | null };

/** Fatura formu için listeler */
export async function loadInvoiceForm(direction: Direction) {
  const supabase = await createClient();
  const [{ data: parties }, { data: items }, { data: tot }, { data: products }, { data: whs }, cats, { rates }, company] = await Promise.all([
    supabase.from("fin_parties").select("id, name, currency, tax_no, kind, is_einvoice, country, payment_term_days, lab_customer_id").eq("is_active", true).order("name").limit(5000),
    supabase.from("stk_items").select("id, code, barcode, name, unit, kind, sale_price, sale_currency, purchase_price, purchase_currency, vat_rate").eq("is_active", true).order("name").limit(5000),
    supabase.from("stk_item_totals").select("item_id, qty").limit(5000),
    direction === "sale" ? supabase.from("lab_products").select("id, name, code, price_try, price_eur").eq("is_active", true).order("sort").order("name") : Promise.resolve({ data: [] }),
    supabase.from("stk_warehouses").select("id, name, is_default").eq("is_active", true).order("is_default", { ascending: false }).order("name"),
    loadCategories(direction === "sale" ? ["income"] : ["expense", "stock"]),
    latestRates(),
    loadCompany(),
  ]);
  const q = new Map((tot ?? []).map((t) => [t.item_id as string, Number(t.qty)]));
  const wanted = direction === "sale" ? ["customer", "both", "other"] : ["supplier", "both", "other"];
  const ps = ((parties ?? []) as (Omit<FormParty, "lab"> & { lab_customer_id: string | null })[])
    .map((p) => ({ id: p.id, name: p.name, currency: p.currency, tax_no: p.tax_no, kind: p.kind, is_einvoice: p.is_einvoice, country: p.country, payment_term_days: p.payment_term_days, lab: !!p.lab_customer_id }))
    .sort((a, b) => Number(wanted.includes(b.kind)) - Number(wanted.includes(a.kind)));
  return {
    parties: ps,
    items: ((items ?? []) as Omit<FormItem, "qty">[]).map((i) => ({ ...i, qty: q.get(i.id) ?? 0 })),
    products: (products ?? []) as FormProduct[],
    warehouses: (whs ?? []) as { id: string; name: string; is_default: boolean }[],
    categories: cats.filter((c) => c.is_active).map((c) => ({ id: c.id, name: c.name, kind: c.kind, code: c.code })),
    rates,
    company,
  };
}

export async function loadCompany(): Promise<Company | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("companies").select("*").order("created_at").limit(1).maybeSingle();
  if (!data) return null;
  const c = data as Company;
  return { ...c, inv_prefix_efatura: c.inv_prefix_efatura ?? "MBD", inv_prefix_earsiv: c.inv_prefix_earsiv ?? "MBA", inv_lab_vat: Number(c.inv_lab_vat ?? 10) };
}

/** Taslak düzenleme ya da kopyalama / iade için formun başlangıç değerleri */
export async function loadInvoiceInitial(id: string, mode: "edit" | "copy" | "return") {
  const supabase = await createClient();
  const [{ data: inv }, { data: lines }] = await Promise.all([
    supabase.from("inv_invoices").select("*").eq("id", id).maybeSingle(),
    supabase.from("inv_lines").select("*").eq("invoice_id", id).order("sort"),
  ]);
  if (!inv) return null;
  const i = inv as Record<string, unknown>;
  const base = {
    direction: i.direction as Direction, party_id: i.party_id as string, currency: i.currency as string, warehouse_id: (i.warehouse_id as string) ?? null,
    note: mode === "return" ? `${i.doc_no ?? ""} numaralı faturanın iadesi` : ((i.note as string) ?? null),
    lines: ((lines ?? []) as Record<string, unknown>[]).map((l) => ({
      item_id: (l.item_id as string) ?? null, lab_product_id: (l.lab_product_id as string) ?? null, category_id: (l.category_id as string) ?? null, job_id: mode === "edit" ? ((l.job_id as string) ?? null) : null,
      name: l.name as string, seller_code: (l.seller_code as string) ?? null, qty: Number(l.qty), unit: l.unit as string, unit_price: Number(l.unit_price), discount_pct: Number(l.discount_pct),
      vat_rate: Number(l.vat_rate), withholding_rate: Number(l.withholding_rate), withholding_code: (l.withholding_code as string) ?? null, vat_exemption_code: (l.vat_exemption_code as string) ?? null,
      lot_no: (l.lot_no as string) ?? null, expiry_date: (l.expiry_date as string) ?? null,
    })),
  };
  if (mode === "edit") {
    return { ...base, id, type: i.type as "invoice" | "return", doc_no: (i.doc_no as string) ?? null, invoice_date: i.invoice_date as string, due_date: (i.due_date as string) ?? null,
      rate: i.currency === "TRY" ? null : String(i.rate).replace(".", ","), profile: (i.profile as string) ?? null, status: i.status as string };
  }
  return { ...base, type: mode === "return" ? ("return" as const) : (i.type as "invoice" | "return"), return_of: mode === "return" ? id : null, status: "draft" };
}

/** Satış faturasının UBL-TR XML'i (içe aktarılmışsa orijinali) */
export async function invoiceXml(id: string): Promise<{ name: string; xml: string } | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("inv_invoices").select("*").eq("id", id).maybeSingle();
  if (!data) return null;
  const inv = data as Invoice & { ubl_xml: string | null };
  const name = `${inv.doc_no ?? `TASLAK-${inv.no}`}.xml`;
  if (inv.ubl_xml) return { name, xml: inv.ubl_xml };
  if (inv.direction !== "sale") return null;
  const [{ data: lines }, co, { data: ret }] = await Promise.all([
    supabase.from("inv_lines").select("*").eq("invoice_id", id).order("sort"),
    loadCompany(),
    inv.return_of ? supabase.from("inv_invoices").select("doc_no, invoice_date").eq("id", inv.return_of).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  if (!co) return null;
  const r = ret as { doc_no: string | null; invoice_date: string } | null;
  return { name, xml: buildUbl(inv, (lines ?? []) as InvLine[], co, { returnOf: r?.doc_no ? { doc_no: r.doc_no, date: r.invoice_date } : null }) };
}
