import "server-only";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import type { SupabaseClient } from "@supabase/supabase-js";
import { CF_SECTIONS, comparePeriods, isLines, isValue, type CashFlow, type IsRow } from "@/lib/gl-reports";
import { lucaBatchFiles, type LucaBatchData } from "@/lib/luca-files";

type Col = { header: string; key: string; width?: number; money?: boolean; date?: boolean; text?: boolean };
type Row = Record<string, unknown>;

export const PACKAGE_PARTS: Array<[string, string]> = [
  ["ozet", "Özet: kokpit aşamaları, beyanname durumları, açık kontroller"],
  ["mizan", "Mizan (aylık ve yıl başından kümülatif)"],
  ["yevmiye", "Yevmiye defteri (ayın fişleri, satır satır)"],
  ["bilanco", "Bilanço (ay sonu)"],
  ["gelir", "Karşılaştırmalı gelir tablosu (bu ay, önceki ay, geçen yıl, yıl başından)"],
  ["nakit", "Nakit akış tablosu (ay ve yıl başından)"],
  ["kdv", "KDV özeti (KDV 1 satış / alış, KDV 2 sorumlu)"],
  ["luca", "Ayın Luca aktarım dosyaları"],
];

function sheet(wb: ExcelJS.Workbook, title: string, cols: Col[], rows: Row[], heading?: string) {
  const ws = wb.addWorksheet(title.slice(0, 31));
  if (heading) { ws.addRow([heading]).font = { bold: true, size: 13 }; ws.addRow([]); }
  const head = ws.addRow(cols.map((c) => c.header));
  head.font = { bold: true, color: { argb: "FFFFFFFF" } };
  head.eachCell((c) => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0A3D73" } }; });
  cols.forEach((c, i) => { ws.getColumn(i + 1).width = c.width ?? (c.money ? 16 : c.date ? 12 : 14); });
  for (const r of rows) {
    const row = ws.addRow(cols.map((c) => {
      const v = r[c.key];
      if (v === null || v === undefined || v === "") return null;
      if (c.money) return Number(v) / 100;
      if (c.date) return new Date(String(v).slice(0, 10) + "T00:00:00Z");
      if (c.text) return String(v);
      return v as ExcelJS.CellValue;
    }));
    cols.forEach((c, i) => { const cell = row.getCell(i + 1); if (c.money) cell.numFmt = "#,##0.00"; else if (c.date) cell.numFmt = "dd.mm.yyyy"; else if (c.text) cell.numFmt = "@"; });
    if (r._bold) row.font = { bold: true };
  }
  ws.views = [{ state: "frozen", ySplit: heading ? 3 : 1 }];
  return ws;
}

const buf = async (wb: ExcelJS.Workbook) => Buffer.from(await wb.xlsx.writeBuffer());
const newWb = () => { const wb = new ExcelJS.Workbook(); wb.creator = "MB Dental ERP"; return wb; };

/** Ay için mali müşavir paketi: Excel dosyaları + Luca dosyaları, tek ZIP */
export async function buildPackage(supabase: SupabaseClient, month: string, company: string, parts: string[] = PACKAGE_PARTS.map(([k]) => k)) {
  const y = Number(month.slice(0, 4));
  const from = `${month}-01`;
  const to = new Date(Date.UTC(y, Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10);
  const ytd = `${y}-01-01`;
  const label = `${company} · ${month}`;
  const files: Array<{ name: string; buf: Buffer }> = [];
  const errors: string[] = [];
  const want = (k: string) => parts.includes(k);
  const rpc = async <T,>(fn: string, args: Record<string, unknown>): Promise<T | null> => {
    const { data, error } = await supabase.rpc(fn, args);
    if (error) { errors.push(`${fn}: ${error.message}`.slice(0, 160)); return null; }
    return data as T;
  };

  if (want("ozet")) {
    const [ck, chk] = await Promise.all([
      rpc<{ stages: Array<{ no: number; title: string; status: string; items: Array<{ label: string; count: number; ok: boolean; status?: string }> }> }>("gl_cockpit", { p_month: month }),
      rpc<Array<{ title: string; area: string; severity: string; count: number; acked: boolean; note: string | null }>>("gl_checks", { p_month: month }),
    ]);
    const wb = newWb();
    const ST: Record<string, string> = { done: "Tamam", active: "Devam ediyor", blocked: "Bekliyor", todo: "Başlanmadı" };
    sheet(wb, "Aşamalar", [{ header: "Aşama", key: "stage", width: 28 }, { header: "Madde", key: "label", width: 70 }, { header: "Durum", key: "state", width: 18 }, { header: "Adet", key: "count", width: 8 }],
      (ck?.stages ?? []).flatMap((s) => [{ stage: `${s.no}. ${s.title}`, label: "", state: ST[s.status] ?? s.status, _bold: true }, ...s.items.map((i) => ({ stage: "", label: i.label, state: i.ok ? "tamam" : (i.status ?? "açık"), count: i.ok ? null : i.count }))]),
      `Mali müşavir paketi — ${label}`);
    sheet(wb, "Kontroller", [{ header: "Alan", key: "area", width: 14 }, { header: "Kontrol", key: "title", width: 70 }, { header: "Önem", key: "sev", width: 10 }, { header: "Adet", key: "count", width: 8 }, { header: "Not", key: "note", width: 40 }],
      (chk ?? []).filter((c) => c.count > 0).map((c) => ({ ...c, sev: c.severity === "critical" ? "Kritik" : c.severity === "warning" ? "Uyarı" : "Bilgi", note: c.acked ? `Bilerek geçildi${c.note ? `: ${c.note}` : ""}` : null })));
    files.push({ name: "01-ozet.xlsx", buf: await buf(wb) });
  }

  if (want("mizan")) {
    const tbCols: Col[] = [
      { header: "Hesap Kodu", key: "code", width: 16, text: true }, { header: "Hesap Adı", key: "name", width: 40 },
      { header: "Devir Borç", key: "open_d", money: true }, { header: "Devir Alacak", key: "open_c", money: true },
      { header: "Dönem Borç", key: "per_d", money: true }, { header: "Dönem Alacak", key: "per_c", money: true },
      { header: "Toplam Borç", key: "tot_d", money: true }, { header: "Toplam Alacak", key: "tot_c", money: true },
      { header: "Borç Bakiye", key: "bal_d", money: true }, { header: "Alacak Bakiye", key: "bal_c", money: true },
    ];
    const [m1, m2] = await Promise.all([
      rpc<Row[]>("gl_trial_balance", { p_from: from, p_to: to, p_level: 5, p_zero: false }),
      rpc<Row[]>("gl_trial_balance", { p_from: ytd, p_to: to, p_level: 5, p_zero: false }),
    ]);
    const wb = newWb();
    const bold = (rows: Row[] | null) => (rows ?? []).map((r) => ({ ...r, _bold: Number(r.lvl) === 1 }));
    sheet(wb, "Aylık", tbCols, bold(m1), `Mizan ${from} – ${to} · ${company}`);
    sheet(wb, "Kümülatif", tbCols, bold(m2), `Mizan ${ytd} – ${to} · ${company}`);
    files.push({ name: "02-mizan.xlsx", buf: await buf(wb) });
  }

  if (want("yevmiye")) {
    const j = await rpc<Array<{ year: number; no: number; jn: number | null; date: string; kind: string; description: string | null; doc_type: string | null; doc_no: string | null; doc_date: string | null; lines: Array<{ code: string; name: string; debit: number; credit: number; description: string | null }> }>>("gl_journal", { p_from: from, p_to: to, p_limit: 20000 });
    const wb = newWb();
    sheet(wb, "Yevmiye", [
      { header: "Yevmiye No", key: "jn", width: 10 }, { header: "Fiş No", key: "no", width: 10 }, { header: "Tarih", key: "date", date: true },
      { header: "Hesap Kodu", key: "code", width: 16, text: true }, { header: "Hesap Adı", key: "name", width: 32 }, { header: "Açıklama", key: "description", width: 44 },
      { header: "Borç", key: "debit", money: true }, { header: "Alacak", key: "credit", money: true }, { header: "Belge No", key: "doc_no", width: 18, text: true }, { header: "Belge Tarihi", key: "doc_date", date: true },
    ], (j ?? []).flatMap((v) => v.lines.map((l) => ({ jn: v.jn, no: v.no, date: v.date, code: l.code, name: l.name, description: l.description ?? v.description, debit: l.debit || null, credit: l.credit || null, doc_no: v.doc_no, doc_date: v.doc_date }))),
      `Yevmiye defteri ${from} – ${to} · ${company}`);
    files.push({ name: "03-yevmiye.xlsx", buf: await buf(wb) });
  }

  if (want("bilanco")) {
    const b = await rpc<Array<{ code: string; name: string; side: string; amount: number }>>("gl_balance_sheet", { p_date: to });
    const wb = newWb();
    const side = (s: string) => (b ?? []).filter((r) => r.side === s);
    const total = (s: string) => side(s).reduce((x, r) => x + Number(r.amount), 0);
    const cols: Col[] = [{ header: "Hesap", key: "code", width: 10, text: true }, { header: "Ad", key: "name", width: 44 }, { header: "Tutar", key: "amount", money: true }];
    sheet(wb, "Aktif", cols, [...side("aktif"), { code: "", name: "AKTİF TOPLAMI", amount: total("aktif"), _bold: true }], `Bilanço ${to} · ${company}`);
    sheet(wb, "Pasif", cols, [...side("pasif"), { code: "", name: "PASİF TOPLAMI", amount: total("pasif"), _bold: true }], `Bilanço ${to} · ${company}`);
    files.push({ name: "04-bilanco.xlsx", buf: await buf(wb) });
  }

  if (want("gelir")) {
    const ps = comparePeriods(month);
    const data = await Promise.all(ps.map((p) => rpc<IsRow[]>("gl_income_statement", { p_from: p.from, p_to: p.to })));
    const rowsets = data.map((d) => d ?? []);
    const wb = newWb();
    const cols: Col[] = [{ header: "Kalem", key: "label", width: 52 }, ...ps.map((p) => ({ header: `${p.label} (${p.from.split("-").reverse().join(".")} – ${p.to.split("-").reverse().join(".")})`, key: p.key, money: true, width: 22 }))];
    sheet(wb, "Gelir tablosu", cols, isLines(rowsets).map((l) => ({ label: l.kind === "line" ? `   ${l.label}` : l.label, _bold: l.kind !== "line", ...Object.fromEntries(ps.map((p, i) => [p.key, isValue(rowsets[i]!, l)])) })),
      `Karşılaştırmalı gelir tablosu · ${label}`);
    files.push({ name: "05-gelir-tablosu.xlsx", buf: await buf(wb) });
  }

  if (want("nakit")) {
    const [a, b] = await Promise.all([rpc<CashFlow>("gl_cash_flow", { p_from: from, p_to: to }), rpc<CashFlow>("gl_cash_flow", { p_from: ytd, p_to: to })]);
    const wb = newWb();
    const flat = (cf: CashFlow | null): Row[] => {
      if (!cf) return [];
      const out: Row[] = [{ label: "Dönem başı hazır değerler", amount: cf.opening, _bold: true }];
      for (const [k, t] of CF_SECTIONS) {
        out.push({ label: t, amount: cf[k], _bold: true });
        for (const r of cf.rows.filter((x) => x.section === k)) out.push({ label: `   ${r.code} ${r.name}`, amount: r.amount });
      }
      out.push({ label: "Dönem sonu hazır değerler", amount: cf.closing, _bold: true });
      return out;
    };
    const cols: Col[] = [{ header: "Kalem", key: "label", width: 56 }, { header: "Tutar", key: "amount", money: true }];
    sheet(wb, "Bu ay", cols, flat(a), `Nakit akış tablosu ${from} – ${to} · ${company}`);
    sheet(wb, "Yıl başından", cols, flat(b), `Nakit akış tablosu ${ytd} – ${to} · ${company}`);
    files.push({ name: "06-nakit-akis.xlsx", buf: await buf(wb) });
  }

  if (want("kdv")) {
    const [v1, v2] = await Promise.all([
      rpc<{ lines: Array<{ direction: string; type: string; vat_rate: number; export: boolean; exemption: string | null; invoices: number; base: number; vat: number; withholding: number }> }>("gl_vat_report", { p_from: from, p_to: to }),
      rpc<{ lines: Array<{ code: string | null; rate: number; vat_rate: number; foreign: boolean; invoices: number; base: number; vat: number }> }>("gl_vat2_report", { p_from: from, p_to: to }),
    ]);
    const wb = newWb();
    sheet(wb, "KDV 1", [
      { header: "Yön", key: "dir", width: 10 }, { header: "Tür", key: "t", width: 10 }, { header: "Oran %", key: "vat_rate", width: 8 }, { header: "İhracat", key: "ex", width: 8 },
      { header: "İstisna", key: "exemption", width: 10 }, { header: "Fatura", key: "invoices", width: 8 }, { header: "Matrah", key: "base", money: true }, { header: "KDV", key: "vat", money: true }, { header: "Tevkifat", key: "withholding", money: true },
    ], (v1?.lines ?? []).map((l) => ({ ...l, dir: l.direction === "sale" ? "Satış" : "Alış", t: l.type === "return" ? "İade" : "Fatura", ex: l.export ? "Evet" : "" })), `KDV özeti ${month} · ${company}`);
    sheet(wb, "KDV 2", [
      { header: "Kod", key: "code", width: 8 }, { header: "Tevkifat oranı", key: "rate", width: 12 }, { header: "KDV %", key: "vat_rate", width: 8 }, { header: "Yurt dışı", key: "fg", width: 9 },
      { header: "Belge", key: "invoices", width: 8 }, { header: "Matrah", key: "base", money: true }, { header: "Sorumlu KDV", key: "vat", money: true },
    ], (v2?.lines ?? []).map((l) => ({ ...l, fg: l.foreign ? "Evet" : "" })), `KDV 2 (sorumlu sıfatıyla) ${month} · ${company}`);
    files.push({ name: "07-kdv.xlsx", buf: await buf(wb) });
  }

  if (want("luca")) {
    const { data: batches } = await supabase.from("gl_luca_batches").select("id,no,from_date,to_date").is("undone_at", null).lte("from_date", to).gte("to_date", from).order("no");
    for (const b of batches ?? []) {
      const d = await rpc<LucaBatchData>("gl_luca_batch", { p_batch: b.id });
      if (d) for (const f of lucaBatchFiles(d)) files.push({ name: `luca/${f.name}`, buf: f.buf });
    }
  }

  const zip = new JSZip();
  for (const f of files) zip.file(f.name, f.buf);
  if (errors.length) zip.file("UYARILAR.txt", `Bazı raporlar üretilemedi:\n${errors.join("\n")}\n`);
  const out = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  return { zip: out, files: files.map((f) => f.name), errors, name: `mali-musavir-paketi-${month}.zip` };
}
