import ExcelJS from "exceljs";
import { NextResponse, type NextRequest } from "next/server";
import { garantiEmeklilikXls, garantiMaasXlsx } from "@/lib/bank-files";
import { loadLuca, lucaXls, lucaXlsx } from "@/lib/luca";
import { findReport, parseParams, visibleColumns } from "@/lib/reports";
import { logAccess } from "@/lib/kvkk";
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
  await logAccess(supabase, s.companyId, s.userId, "export", "report", key, `${p.period}${p.department ? " · " + p.department : ""}`);
  const cols = visibleColumns(def, res, s.role);

  // Banka formatındaki dosyalar (?bicim=tablo ile düz Excel de alınabilir)
  if (req.nextUrl.searchParams.get("bicim") !== "tablo") {
    if (key === "luca-puantaj") {
      const d = await loadLuca(supabase, p.period, p.department);
      const name = `LUCA-PUANTAJ-${p.period}${p.department ? "-" + p.department : ""}`;
      if (req.nextUrl.searchParams.get("bicim") === "xls") {
        return new NextResponse(new Uint8Array(lucaXls(d, p.department)), {
          headers: { "Content-Type": "application/vnd.ms-excel", "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}.xls` },
        });
      }
      const buf = await lucaXlsx(d, p.department);
      return new NextResponse(buf, {
        headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}.xlsx` },
      });
    }
    if (key === "banka-maas") {
      const buf = await garantiMaasXlsx(
        res.rows.map((r) => ({ tckn: String(r.tckn ?? ""), ad: String(r.ad ?? ""), iban: String(r.iban ?? ""), tutar: Number(r.tutar ?? 0) })),
        p.period,
        p.payDate,
      );
      return new NextResponse(new Uint8Array(buf), {
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(`GARANTI-MAAS-${p.period}`)}.xlsx`,
        },
      });
    }
    if (key === "bes-liste") {
      const buf = garantiEmeklilikXls(
        res.rows.map((r) => ({ tckn: String(r.tckn ?? ""), ad: String(r.ad ?? ""), soyad: String(r.soyad ?? ""), oran: Number(r.oran ?? 3), tutar: Number(r.tutar ?? 0) })),
        p.period,
        p.payDate,
      );
      return new NextResponse(new Uint8Array(buf), {
        headers: {
          "Content-Type": "application/vnd.ms-excel",
          "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(`GARANTI-EMEKLILIK-BES-${p.period}`)}.xls`,
        },
      });
    }
  }

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
