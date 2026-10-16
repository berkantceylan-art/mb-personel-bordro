import "server-only";
import ExcelJS from "exceljs";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DOC, docDate, docMoney, stNo, wbNo } from "@/lib/waybill";

export type DocKind = "waybill" | "statement";
type Cust = { id: string; name: string; email: string | null; phone: string | null; doc_lang: string | null; address: string | null; city: string | null; country: string | null; tax_no: string | null };
type Item = { name: string; qty: number; unit_price: number; amount: number; sort: number };
type Job = { id: string; no: number; patient: string | null; doctor_name: string | null; total: number; shade: string | null; waybill_id: string; job_items: Item[] };
export type WbDoc = { kind: "waybill"; id: string; no: string; date: string; currency: string; total: number; job_count: number; unit_count: number; status: string; lang: string; customer: Cust; jobs: Job[] };
export type StDoc = { kind: "statement"; id: string; no: string; date: string; from: string; to: string; due: string | null; currency: string; total: number; job_count: number; unit_count: number; status: string; lang: string; customer: Cust;
  waybills: { id: string; no: string; date: string; total: number; job_count: number; jobs: Job[] }[] };

const CUST = "id, name, email, phone, doc_lang, address, city, country, tax_no";
const JOBQ = "id, no, patient, doctor_name, total, shade, waybill_id, job_items(name, qty, unit_price, amount, sort)";
const lng = (l: string | null | undefined) => (l === "fr" || l === "en" ? l : "tr");

export async function loadWaybillDocs(sb: SupabaseClient, ids: string[]): Promise<WbDoc[]> {
  if (!ids.length) return [];
  const { data: ws } = await sb.from("lab_waybills").select(`id, year, no, ship_date, currency, total, job_count, unit_count, status, lab_customers(${CUST})`).in("id", ids);
  const { data: js } = await sb.from("jobs").select(JOBQ).in("waybill_id", ids).order("no");
  const jobs = (js ?? []) as unknown as Job[];
  return ((ws ?? []) as unknown as { id: string; year: number; no: number; ship_date: string; currency: string; total: number; job_count: number; unit_count: number; status: string; lab_customers: Cust }[])
    .map((w) => ({ kind: "waybill" as const, id: w.id, no: wbNo(w.year, w.no), date: w.ship_date, currency: w.currency, total: Number(w.total), job_count: w.job_count, unit_count: Number(w.unit_count), status: w.status,
      lang: lng(w.lab_customers?.doc_lang), customer: w.lab_customers, jobs: jobs.filter((j) => j.waybill_id === w.id) }))
    .sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
}

export async function loadStatementDocs(sb: SupabaseClient, ids: string[]): Promise<StDoc[]> {
  if (!ids.length) return [];
  const { data: ss } = await sb.from("lab_statements").select(`id, year, no, issue_date, period_from, period_to, due_date, currency, total, job_count, unit_count, status, lang, lab_customers(${CUST})`).in("id", ids);
  const { data: ws } = await sb.from("lab_waybills").select("id, year, no, ship_date, total, job_count, statement_id").in("statement_id", ids).order("ship_date");
  const wbs = (ws ?? []) as { id: string; year: number; no: number; ship_date: string; total: number; job_count: number; statement_id: string }[];
  const { data: js } = wbs.length ? await sb.from("jobs").select(JOBQ).in("waybill_id", wbs.map((w) => w.id)).order("no") : { data: [] };
  const jobs = (js ?? []) as unknown as Job[];
  return ((ss ?? []) as unknown as { id: string; year: number; no: number; issue_date: string; period_from: string; period_to: string; due_date: string | null; currency: string; total: number; job_count: number; unit_count: number; status: string; lang: string; lab_customers: Cust }[])
    .map((s) => ({ kind: "statement" as const, id: s.id, no: stNo(s.year, s.no), date: s.issue_date, from: s.period_from, to: s.period_to, due: s.due_date, currency: s.currency, total: Number(s.total), job_count: s.job_count, unit_count: Number(s.unit_count),
      status: s.status, lang: lng(s.lang), customer: s.lab_customers,
      waybills: wbs.filter((w) => w.statement_id === s.id).map((w) => ({ id: w.id, no: wbNo(w.year, w.no), date: w.ship_date, total: Number(w.total), job_count: w.job_count, jobs: jobs.filter((j) => j.waybill_id === w.id) })) }))
    .sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
}

const itemsOf = (j: Job) => j.job_items.filter((i) => i.amount > 0).sort((a, b) => a.sort - b.sort);

/** Belge(ler)in Excel dosyası: her belge ayrı sayfa, birden çoksa başta özet sayfası */
export async function docsXlsx(docs: (WbDoc | StDoc)[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "MB Dental ERP";
  const head = (ws: ExcelJS.Worksheet, row: number) => { const r = ws.getRow(row); r.font = { bold: true }; r.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEEF2F6" } }; };
  const money = (v: number) => Math.round(v) / 100;
  if (docs.length > 1) {
    const ws = wb.addWorksheet("Özet");
    ws.columns = [{ header: "Belge no", width: 18 }, { header: "Tarih", width: 12 }, { header: "Müşteri", width: 36 }, { header: "İş", width: 8 }, { header: "Tutar", width: 14 }, { header: "Para birimi", width: 10 }];
    head(ws, 1);
    for (const d of docs) ws.addRow([d.no, d.date, d.customer?.name ?? "", d.job_count, money(d.total), d.currency]);
    ws.getColumn(5).numFmt = "#,##0.00";
  }
  for (const d of docs) {
    const t = DOC[d.lang] ?? DOC.tr!;
    const ws = wb.addWorksheet(d.no.replace(/[\\/*?:[\]]/g, "-").slice(0, 31));
    ws.addRow([d.kind === "waybill" ? t.waybill : t.invoice, d.no]).font = { bold: true, size: 13 };
    ws.addRow([t.date, docDate(d.date, d.lang)]);
    if (d.kind === "statement") ws.addRow([t.period, `${docDate(d.from, d.lang)} – ${docDate(d.to, d.lang)}`]);
    ws.addRow([t.customer, d.customer?.name ?? ""]);
    ws.addRow([]);
    const hdr = d.kind === "waybill" ? [t.job, t.patient, t.doctor, t.work, t.qty, t.unit, t.amount] : [t.waybills, t.date, t.job, t.patient, t.work, t.qty, t.amount];
    const hr = ws.addRow(hdr).number; head(ws, hr);
    const jobsRows = d.kind === "waybill" ? d.jobs.map((j) => ({ wb: "", wd: "", j })) : d.waybills.flatMap((w) => w.jobs.map((j) => ({ wb: w.no, wd: w.date, j })));
    for (const { wb: wno, wd, j } of jobsRows) {
      const it = itemsOf(j);
      const work = it.map((i) => i.name).join(", ");
      const qty = it.reduce((a, i) => a + Number(i.qty), 0);
      if (d.kind === "waybill") ws.addRow([`#${j.no}`, j.patient ?? "", j.doctor_name ?? "", work, qty, it.length === 1 ? money(it[0]!.unit_price) : null, money(j.total)]);
      else ws.addRow([wno, docDate(wd, d.lang), `#${j.no}`, j.patient ?? "", work, qty, money(j.total)]);
    }
    const tr = ws.addRow(d.kind === "waybill" ? ["", "", "", t.total, d.unit_count, "", money(d.total)] : ["", "", "", "", t.total, d.unit_count, money(d.total)]);
    tr.font = { bold: true };
    ws.addRow([]); ws.addRow([`${d.currency}`]);
    ws.columns.forEach((c, i) => { c.width = [16, 14, 12, 30, 40, 8, 14][i] ?? 14; });
    ws.getColumn(d.kind === "waybill" ? 6 : 7).numFmt = "#,##0.00";
    ws.getColumn(7).numFmt = "#,##0.00";
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const MAIL: Record<string, { hello: string; wb: string; st: string; attach: string; regards: string; subjWb: string; subjSt: string }> = {
  tr: { hello: "Sayın", wb: "Bugün size gönderdiğimiz işlerin sevk irsaliyesi aşağıdadır.", st: "Dönem faturanız aşağıdadır.", attach: "Ayrıntılı döküm ekteki Excel dosyasındadır.", regards: "Saygılarımızla,", subjWb: "Sevk irsaliyesi", subjSt: "Aylık fatura" },
  fr: { hello: "Bonjour", wb: "Veuillez trouver ci-dessous le bon de livraison des cas expédiés aujourd'hui.", st: "Veuillez trouver ci-dessous votre facture mensuelle.", attach: "Le détail figure dans le fichier Excel joint.", regards: "Cordialement,", subjWb: "Bon de livraison", subjSt: "Facture mensuelle" },
  en: { hello: "Dear", wb: "Please find below the delivery note for the cases shipped today.", st: "Please find below your monthly invoice.", attach: "The detailed list is in the attached Excel file.", regards: "Kind regards,", subjWb: "Delivery note", subjSt: "Monthly invoice" },
};

/** Belgenin e-posta metni (müşterinin dilinde) */
export function docEmail(d: WbDoc | StDoc, company: string, banks: string[]): { subject: string; html: string; text: string } {
  const m = MAIL[d.lang] ?? MAIL.tr!;
  const t = DOC[d.lang] ?? DOC.tr!;
  const rows = (d.kind === "waybill" ? d.jobs : d.waybills.flatMap((w) => w.jobs)).map((j) =>
    `<tr><td style="padding:5px 8px;border-bottom:1px solid #eee">#${j.no}</td><td style="padding:5px 8px;border-bottom:1px solid #eee">${esc(j.patient ?? "")}</td><td style="padding:5px 8px;border-bottom:1px solid #eee">${esc(itemsOf(j).map((i) => i.name).join(", "))}</td><td style="padding:5px 8px;border-bottom:1px solid #eee;text-align:right">${docMoney(j.total, d.currency, d.lang)}</td></tr>`).join("");
  const title = `${d.kind === "waybill" ? t.waybill : t.invoice} ${d.no}`;
  const period = d.kind === "statement" ? ` · ${t.period}: ${docDate(d.from, d.lang)} – ${docDate(d.to, d.lang)}` : "";
  const html = `<div style="font-family:Arial,sans-serif;color:#1d2733;max-width:720px">
<p>${m.hello} ${esc(d.customer?.name ?? "")},</p><p>${d.kind === "waybill" ? m.wb : m.st}</p>
<p style="font-size:17px;font-weight:bold;margin:14px 0 6px">${esc(title)}</p><p style="margin:0 0 10px;color:#5b6b7c">${t.date}: ${docDate(d.date, d.lang)}${period}${d.kind === "statement" && d.due ? ` · ${t.due}: ${docDate(d.due, d.lang)}` : ""}</p>
<table style="border-collapse:collapse;width:100%;font-size:13px"><thead><tr style="background:#f3f6f9;text-align:left"><th style="padding:5px 8px">${t.job}</th><th style="padding:5px 8px">${t.patient}</th><th style="padding:5px 8px">${t.work}</th><th style="padding:5px 8px;text-align:right">${t.amount}</th></tr></thead><tbody>${rows}</tbody>
<tfoot><tr><td colspan="3" style="padding:6px 8px;text-align:right;font-weight:bold">${d.job_count} ${t.jobs} · ${t.total}</td><td style="padding:6px 8px;text-align:right;font-weight:bold">${docMoney(d.total, d.currency, d.lang)}</td></tr></tfoot></table>
<p>${m.attach}</p>${d.kind === "statement" && banks.length ? `<p><b>${t.bank}:</b><br>${banks.map(esc).join("<br>")}</p>` : ""}
<p>${m.regards}<br>${esc(company)}</p></div>`;
  const text = `${m.hello} ${d.customer?.name ?? ""},\n${d.kind === "waybill" ? m.wb : m.st}\n\n${title} · ${docDate(d.date, d.lang)}${period}\n${d.job_count} ${t.jobs} · ${t.total}: ${docMoney(d.total, d.currency, d.lang)}\n\n${m.attach}\n${m.regards}\n${company}`;
  return { subject: `${company} · ${d.kind === "waybill" ? m.subjWb : m.subjSt} ${d.no}`, html, text };
}
