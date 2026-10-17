import ExcelJS from "exceljs";
import { NextResponse, type NextRequest } from "next/server";
import { currentPeriod, getSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { groupBy, loadPieceEntries, prevMonth, STATUS } from "@/lib/piecework";

const P = /^\d{4}-\d{2}$/;
const tl = (k: number) => Math.round(k) / 100;

/** Parça başı raporu Excel: kayıtlar + usta + ürün özeti */
export async function GET(req: NextRequest) {
  const s = await getSession();
  const mgr = ["owner", "hr", "accountant", "branch_manager"].includes(s.role);
  if (!mgr && (s.modules.production ?? 0) < 1 && (s.modules.payroll ?? 0) < 1 && (s.modules.finance ?? 0) < 1) return new NextResponse("Yetkiniz yok", { status: 403 });
  const sp = req.nextUrl.searchParams;
  const to = P.test(sp.get("bit") ?? "") ? sp.get("bit")! : currentPeriod();
  const from = P.test(sp.get("bas") ?? "") ? sp.get("bas")! : prevMonth(prevMonth(to));
  const { rows: all, error } = await loadPieceEntries(await createClient(), from, to, sp.get("durum") === "aktarilan" ? { status: "posted" } : {});
  if (error) return new NextResponse(error, { status: 500 });
  const rows = all.filter((r) => r.status !== "rejected");
  const wb = new ExcelJS.Workbook();
  const money = "#,##0.00 ₺";

  const ws = wb.addWorksheet("Kayıtlar");
  ws.columns = [
    { header: "Tarih", key: "d", width: 12 }, { header: "Dönem", key: "p", width: 9 }, { header: "Usta", key: "w", width: 24 }, { header: "Tür", key: "k", width: 10 },
    { header: "İş no", key: "j", width: 10 }, { header: "Ürün / iş", key: "pr", width: 32 }, { header: "Adet", key: "q", width: 8 }, { header: "Birim", key: "u", width: 8 },
    { header: "Birim fiyat", key: "up", width: 13, style: { numFmt: money } }, { header: "Tutar", key: "a", width: 14, style: { numFmt: money } },
    { header: "Stopaj", key: "st", width: 12, style: { numFmt: money } }, { header: "Net", key: "n", width: 14, style: { numFmt: money } },
    { header: "Durum", key: "s", width: 14 }, { header: "Not", key: "no", width: 30 },
  ];
  for (const r of rows) ws.addRow({ d: r.work_date, p: r.period, w: r.worker, k: r.kind === "internal" ? "Personel" : "Dış usta", j: r.job_no ?? "", pr: r.product ?? r.work_name, q: r.qty, u: r.unit, up: tl(r.unit_price), a: tl(r.amount), st: tl(Number(r.stopaj_amount ?? 0)), n: tl(Number(r.net_amount ?? r.amount)), s: STATUS[r.status].label, no: r.note ?? "" });
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: "frozen", ySplit: 1 }];
  ws.autoFilter = { from: "A1", to: "N1" };

  const sum = (name: string, title: string, groups: ReturnType<typeof groupBy>) => {
    const sh = wb.addWorksheet(name);
    sh.columns = [{ header: title, key: "k", width: 34 }, { header: "Adet", key: "q", width: 10 }, { header: "Kayıt", key: "n", width: 8 }, { header: "Tutar", key: "a", width: 16, style: { numFmt: money } }, { header: "Ort. birim", key: "o", width: 14, style: { numFmt: money } }];
    for (const [k, g] of groups) sh.addRow({ k, q: g.qty, n: g.n, a: tl(g.amount), o: tl(g.qty ? g.amount / g.qty : 0) });
    sh.getRow(1).font = { bold: true };
  };
  sum("Usta", "Usta", groupBy(rows, (r) => `${r.worker} (${r.kind === "internal" ? "personel" : "dış"})`, (r) => r.qty, (r) => r.amount));
  sum("Ürün", "Ürün / iş", groupBy(rows, (r) => r.product ?? r.work_name, (r) => r.qty, (r) => r.amount));
  sum("Ay", "Dönem", groupBy(rows, (r) => `${r.period} ${r.kind === "internal" ? "personel" : "dış usta"}`, (r) => r.qty, (r) => r.amount));

  const buf = await wb.xlsx.writeBuffer();
  return new NextResponse(buf as ArrayBuffer, {
    headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="parca-basi-${from}_${to}.xlsx"` },
  });
}
