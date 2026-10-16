import ExcelJS from "exceljs";
import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { POSTPONE_REASONS, todayTR } from "@/lib/postpone";
import { loadPostpones } from "@/lib/postpone-report";

/** Erteleme raporu Excel (rapor ekranıyla aynı filtreler) */
export async function GET(req: NextRequest) {
  const s = await getSession();
  if (!s.logistics && (s.modules.production ?? 0) < 1) return new NextResponse("Yetkiniz yok", { status: 403 });
  const q = req.nextUrl.searchParams;
  const ok = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
  const to = ok(q.get("bit")) ?? todayTR();
  const from = ok(q.get("bas")) ?? to;
  const { rows } = await loadPostpones(await createClient(), { from, to, reason: q.get("sebep") || undefined, customer: q.get("hekim") || undefined });
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Ertelemeler");
  ws.columns = [
    { header: "Zaman", key: "at", width: 18 }, { header: "İş no", key: "no", width: 9 }, { header: "Hasta", key: "patient", width: 22 }, { header: "Hekim", key: "customer", width: 30 },
    { header: "Eski tarih", key: "from", width: 12 }, { header: "Yeni tarih", key: "to", width: 12 }, { header: "Kayma (gün)", key: "days", width: 11 }, { header: "Sebep", key: "reason", width: 24 },
    { header: "Not", key: "note", width: 30 }, { header: "Erteleyen", key: "by", width: 20 }, { header: "Toplam erteleme", key: "count", width: 14 }, { header: "Durum", key: "status", width: 12 },
  ];
  ws.getRow(1).font = { bold: true };
  for (const r of rows) ws.addRow({ ...r, at: new Date(r.at).toLocaleString("tr-TR", { timeZone: "Europe/Istanbul" }), reason: POSTPONE_REASONS[r.reason] ?? r.reason, note: r.note ?? "", patient: r.patient ?? "" });
  const sum = wb.addWorksheet("Özet");
  sum.addRow(["Dönem", `${from} – ${to}`]); sum.addRow(["Erteleme", rows.length]); sum.addRow(["Farklı iş", new Set(rows.map((r) => r.job_id)).size]); sum.addRow([]);
  sum.addRow(["Sebep", "Adet"]).font = { bold: true };
  const by = new Map<string, number>(); for (const r of rows) by.set(r.reason, (by.get(r.reason) ?? 0) + 1);
  for (const [k, n] of [...by.entries()].sort((a, b) => b[1] - a[1])) sum.addRow([POSTPONE_REASONS[k] ?? k, n]);
  sum.addRow([]); sum.addRow(["Hekim", "Adet"]).font = { bold: true };
  const bc = new Map<string, number>(); for (const r of rows) bc.set(r.customer, (bc.get(r.customer) ?? 0) + 1);
  for (const [k, n] of [...bc.entries()].sort((a, b) => b[1] - a[1])) sum.addRow([k, n]);
  sum.getColumn(1).width = 34;
  const buf = await wb.xlsx.writeBuffer();
  return new NextResponse(new Uint8Array(buf as ArrayBuffer), { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(`erteleme-raporu-${from}-${to}`)}.xlsx` } });
}
