import ExcelJS from "exceljs";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { canManagePay, getSession, periodLabel } from "@/lib/session";

export async function GET(req: NextRequest) {
  const s = await getSession();
  if (!canManagePay(s.role)) return new NextResponse("Yetkiniz yok", { status: 403 });
  const period = req.nextUrl.searchParams.get("donem") ?? "";
  if (!/^\d{4}-\d{2}$/.test(period)) return new NextResponse("Dönem geçersiz", { status: 400 });
  const supabase = await createClient();
  const [{ data: lines }, { data: emps }, { data: privs }, { data: enr }] = await Promise.all([
    supabase.from("payroll_lines").select("employee_id, bes, official_gross").eq("period", period).gt("bes", 0),
    supabase.from("employees").select("id, first_name, last_name"),
    supabase.from("employee_private").select("employee_id, national_id, sgk_no"),
    supabase.from("bes_enrollments").select("employee_id, policy_no, rate").eq("status", "active"),
  ]);
  const emp = new Map((emps ?? []).map((e) => [e.id, e]));
  const priv = new Map((privs ?? []).map((p) => [p.employee_id, p]));
  const pol = new Map((enr ?? []).map((e) => [e.employee_id, e]));

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(`BES ${periodLabel(period)}`);
  ws.columns = [
    { header: "TC Kimlik No", key: "tc", width: 14 },
    { header: "Ad", key: "ad", width: 16 },
    { header: "Soyad", key: "soyad", width: 16 },
    { header: "SGK No", key: "sgk", width: 14 },
    { header: "Poliçe No", key: "police", width: 14 },
    { header: "Oran %", key: "oran", width: 8 },
    { header: "Prime Esas Kazanç", key: "pek", width: 18, style: { numFmt: '#,##0.00' } },
    { header: "Kesinti Tutarı", key: "tutar", width: 16, style: { numFmt: '#,##0.00' } },
  ];
  for (const l of lines ?? []) {
    const e = emp.get(l.employee_id);
    ws.addRow({
      tc: priv.get(l.employee_id)?.national_id ?? "",
      ad: e?.first_name ?? "",
      soyad: e?.last_name ?? "",
      sgk: priv.get(l.employee_id)?.sgk_no ?? "",
      police: pol.get(l.employee_id)?.policy_no ?? "",
      oran: Number(pol.get(l.employee_id)?.rate ?? 0.03) * 100,
      pek: Number(l.official_gross) / 100,
      tutar: Number(l.bes) / 100,
    });
  }
  ws.getRow(1).font = { bold: true };
  const buf = await wb.xlsx.writeBuffer();
  return new NextResponse(buf as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="bes-${period}.xlsx"`,
    },
  });
}
