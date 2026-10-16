import ExcelJS from "exceljs";
import { NextResponse, type NextRequest } from "next/server";
import { getSession, todayIso } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { FLOW_STAGE } from "@/lib/flow";

/** Prova / teslim listesi Excel: gecikenler + önümüzdeki N gün */
export async function GET(req: NextRequest) {
  const s = await getSession();
  if (!s.logistics) return new NextResponse("Yetkiniz yok", { status: 403 });
  const days = Math.min(30, Math.max(1, Number(req.nextUrl.searchParams.get("gun")) || 7));
  const today = todayIso();
  const until = new Date(Date.parse(`${today}T12:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
  const sb = await createClient();
  const [{ data: st }, { data: due }, { data: cs }] = await Promise.all([
    sb.from("job_steps").select("kind, out_date, back_date, delivery_method, delivery_time, jobs(no, patient, doctor_name, customer_id, status, flow_stage)").eq("done", false).lte("out_date", until).limit(3000),
    sb.from("jobs").select("no, patient, doctor_name, customer_id, due_date, delivery_time, delivery_method, status, flow_stage").in("status", ["open", "tryin", "ready"]).lte("due_date", until).limit(3000),
    sb.from("lab_customers").select("id, name"),
  ]);
  const names = new Map(((cs ?? []) as { id: string; name: string }[]).map((c) => [c.id, c.name]));
  type J = { no: number; patient: string | null; doctor_name: string | null; customer_id: string | null; status: string; flow_stage: string | null };
  const rows: (string | number)[][] = [];
  for (const r of (st ?? []) as unknown as { kind: string; out_date: string | null; back_date: string | null; delivery_method: string | null; delivery_time: string | null; jobs: J | null }[]) {
    if (!r.jobs || !r.out_date || ["delivered", "cancelled"].includes(r.jobs.status)) continue;
    rows.push([r.out_date, r.delivery_time ?? "", r.kind, r.jobs.no, names.get(r.jobs.customer_id ?? "") ?? "", r.jobs.patient ?? "", r.jobs.doctor_name ?? "", r.delivery_method ?? "", r.back_date ?? "", FLOW_STAGE[r.jobs.flow_stage ?? ""]?.[0] ?? "", r.out_date < today ? "Gecikmiş" : ""]);
  }
  for (const j of (due ?? []) as (J & { due_date: string; delivery_time: string | null; delivery_method: string | null })[])
    rows.push([j.due_date, j.delivery_time ?? "", "Teslim", j.no, names.get(j.customer_id ?? "") ?? "", j.patient ?? "", j.doctor_name ?? "", j.delivery_method ?? "", "", FLOW_STAGE[j.flow_stage ?? ""]?.[0] ?? "", j.due_date < today ? "Gecikmiş" : ""]);
  rows.sort((a, b) => `${a[0]}${a[1] || "99"}`.localeCompare(`${b[0]}${b[1] || "99"}`));
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Prova-teslim");
  ws.addRow(["Tarih", "Saat", "Tür", "İş no", "Hekim / hastane", "Hasta", "Doktor", "Teslim şekli", "Dönüş", "Üretim durumu", "Not"]).font = { bold: true };
  rows.forEach((r) => ws.addRow(r));
  [12, 7, 14, 8, 30, 22, 18, 14, 12, 20, 10].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  const buf = await wb.xlsx.writeBuffer();
  return new NextResponse(new Uint8Array(buf as ArrayBuffer), { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(`prova-teslim-${today}`)}.xlsx` } });
}
