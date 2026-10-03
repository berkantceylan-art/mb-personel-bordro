import ExcelJS from "exceljs";
import { NextResponse, type NextRequest } from "next/server";
import { findReport, parseParams, visibleColumns } from "@/lib/reports";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";

export async function GET(req: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const def = findReport(key);
  if (!def) return new NextResponse("Rapor bulunamadı", { status: 404 });
  const s = await getSession();
  if (!def.roles.includes(s.role)) return new NextResponse("Yetkiniz yok", { status: 403 });
  const p = parseParams(Object.fromEntries(req.nextUrl.searchParams.entries()));
  const supabase = await createClient();
  const res = await def.run(supabase, p);
  const cols = visibleColumns(def, res, s.role);

  const wb = new ExcelJS.Workbook();
  wb.creator = "MB Personel & Bordro";
  const ws = wb.addWorksheet(res.title.slice(0, 31).replace(/[\\/?*[\]:]/g, " "));
  ws.columns = cols.map((c) => ({
    header: c.label,
    key: c.key,
    width: c.width ?? (c.type === "money" ? 16 : c.type === "date" ? 12 : 14),
    style: c.type === "money" ? { numFmt: "#,##0.00" } : c.type === "date" ? { numFmt: "dd.mm.yyyy" } : {},
  }));
  const conv = (v: unknown, t?: string) => {
    if (v === null || v === undefined || v === "") return null;
    if (t === "money") return Number(v) / 100;
    if (t === "date") return new Date(String(v).slice(0, 10) + "T00:00:00Z");
    return v;
  };
  for (const r of res.rows) ws.addRow(Object.fromEntries(cols.map((c) => [c.key, conv(r[c.key], c.type)])));
  if (res.totals && res.rows.length) {
    const t = ws.addRow(Object.fromEntries(cols.map((c) => [c.key, conv(res.totals![c.key], c.type)])));
    t.font = { bold: true };
  }
  const head = ws.getRow(1);
  head.font = { bold: true, color: { argb: "FFFFFFFF" } };
  head.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0A3D73" } };
  ws.views = [{ state: "frozen", ySplit: 1 }];
  if (cols.some((c) => c.key === "tckn" || c.key === "iban")) {
    for (const k of ["tckn", "iban", "pdks", "sgk"]) if (cols.some((c) => c.key === k)) ws.getColumn(k).numFmt = "@";
  }

  const buf = await wb.xlsx.writeBuffer();
  return new NextResponse(buf as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(res.fileName)}.xlsx`,
    },
  });
}
