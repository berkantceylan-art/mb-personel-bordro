import ExcelJS from "exceljs";
import { NextResponse, type NextRequest } from "next/server";
import { currentPeriod, getSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { attReport } from "@/lib/att-report";

/** Aylık puantaj hata raporu Excel */
export async function GET(req: NextRequest) {
  const s = await getSession();
  if (!["owner", "hr", "accountant", "branch_manager"].includes(s.role)) return new NextResponse("Yetkiniz yok", { status: 403 });
  const ay = req.nextUrl.searchParams.get("ay") ?? "";
  const period = /^\d{4}-\d{2}$/.test(ay) ? ay : currentPeriod();
  let rows;
  try { rows = await attReport(await createClient(), period); } catch (e) { return new NextResponse((e as Error).message, { status: 500 }); }
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(`Puantaj hataları ${period}`);
  ws.columns = [
    { header: "Personel", key: "name", width: 26 }, { header: "Bölüm", key: "dept", width: 18 }, { header: "Kart unuttu", key: "forgot", width: 12 },
    { header: "Hak aşımı", key: "forgotOver", width: 11 }, { header: "Onayda", key: "forgotPending", width: 9 }, { header: "Eksik okutma", key: "missing", width: 13 },
    { header: "Geç gelme (adet)", key: "late", width: 15 }, { header: "Geç gelme (dk)", key: "lateMin", width: 14 }, { header: "Erken çıkma (adet)", key: "early", width: 16 },
    { header: "Erken çıkma (dk)", key: "earlyMin", width: 15 }, { header: "Devamsız", key: "absent", width: 10 }, { header: "11 sa aşımı", key: "longDays", width: 11 },
    { header: "Fazla mesai (gün)", key: "overtimeDays", width: 15 }, { header: "Fazla mesai (dk)", key: "overtimeMin", width: 15 },
    { header: "Düzeltilen", key: "fixed", width: 11 }, { header: "Kabul edilen", key: "accepted", width: 12 }, { header: "Açık", key: "open", width: 8 }, { header: "Toplam hata", key: "total", width: 12 },
  ];
  for (const r of rows) ws.addRow(r);
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: "frozen", ySplit: 1 }];
  const buf = await wb.xlsx.writeBuffer();
  return new NextResponse(buf as ArrayBuffer, {
    headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="puantaj-hata-raporu-${period}.xlsx"` },
  });
}
