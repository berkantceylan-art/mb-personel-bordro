import ExcelJS from "exceljs";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

type Col = { header: string; key: string; width?: number; money?: boolean; date?: boolean; text?: boolean };

/** KDV iade dosyası: ihracat faturaları (GÇB / ETGB) ve yüklenilen KDV listesi, ay bazında */
export async function GET(req: Request) {
  const s = await getSession();
  if ((s.modules.ledger ?? 0) < 1) return NextResponse.json({ error: "yetkisiz" }, { status: 403 });
  const ay = new URL(req.url).searchParams.get("ay") ?? "";
  if (!/^\d{4}-\d{2}$/.test(ay)) return NextResponse.json({ error: "ay" }, { status: 400 });
  const from = `${ay}-01`;
  const to = new Date(Date.UTC(Number(ay.slice(0, 4)), Number(ay.slice(5, 7)), 0)).toISOString().slice(0, 10);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("gl_vat_refund_list", { p_from: from, p_to: to });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  const d = data as { exports: Array<Record<string, unknown>>; purchases: Array<Record<string, unknown>>; others: Array<Record<string, unknown>> };

  const wb = new ExcelJS.Workbook();
  wb.creator = "MB Dental ERP";
  const sheet = (title: string, cols: Col[], rows: Array<Record<string, unknown>>) => {
    const ws = wb.addWorksheet(title);
    ws.columns = cols.map((c) => ({ header: c.header, key: c.key, width: c.width ?? (c.money ? 16 : c.date ? 12 : 14), style: c.money ? { numFmt: "#,##0.00" } : c.date ? { numFmt: "dd.mm.yyyy" } : c.text ? { numFmt: "@" } : {} }));
    for (const r of rows) {
      ws.addRow(Object.fromEntries(cols.map((c) => {
        const v = r[c.key];
        if (v === null || v === undefined || v === "") return [c.key, null];
        if (c.money) return [c.key, Number(v) / 100];
        if (c.date) return [c.key, new Date(String(v).slice(0, 10) + "T00:00:00Z")];
        if (c.text) return [c.key, String(v)];
        return [c.key, v];
      })));
    }
    const head = ws.getRow(1);
    head.font = { bold: true, color: { argb: "FFFFFFFF" } };
    head.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0A3D73" } };
    ws.views = [{ state: "frozen", ySplit: 1 }];
  };

  sheet("İhracat faturaları", [
    { header: "Sıra", key: "i", width: 6 }, { header: "Fatura Tarihi", key: "date", date: true }, { header: "Fatura No", key: "doc_no", width: 18, text: true },
    { header: "Alıcı", key: "party", width: 32 }, { header: "Ülke", key: "country", width: 8 }, { header: "Döviz", key: "currency", width: 7 },
    { header: "Döviz Tutarı", key: "total_fx", money: true }, { header: "Kur", key: "rate", width: 10 }, { header: "TL Tutarı", key: "base", money: true },
    { header: "Belge Türü", key: "kind", width: 8 }, { header: "GÇB / ETGB No", key: "doc_no2", width: 22, text: true }, { header: "Belge Tarihi", key: "doc_date", date: true },
  ], d.exports.map((x, i) => ({ ...x, i: i + 1, kind: x.doc_kind === "gb" ? "GÇB" : x.doc_kind === "etgb" ? "ETGB" : "" })));

  sheet("Yüklenilen KDV", [
    { header: "Sıra", key: "i", width: 6 }, { header: "Belge Tarihi", key: "date", date: true }, { header: "Belge No", key: "doc_no", width: 18, text: true },
    { header: "Satıcı Adı", key: "party", width: 32 }, { header: "Satıcı VKN / TCKN", key: "tax_no", width: 14, text: true },
    { header: "Mal / Hizmet Cinsi", key: "items", width: 36 }, { header: "KDV Hariç Tutar", key: "base", money: true }, { header: "KDV", key: "vat", money: true },
    { header: "Dönem", key: "period", width: 9 },
  ], [
    ...d.purchases.map((x) => ({ ...x, items: x.type === "return" ? `İADE · ${x.items ?? ""}` : x.items })),
    ...d.others.map((x) => ({ date: x.date, doc_no: x.doc_no, party: x.party, items: x.description, vat: x.vat })),
  ].map((x, i) => ({ ...x, i: i + 1, period: ay })));

  const buf = await wb.xlsx.writeBuffer();
  return new NextResponse(buf as ArrayBuffer, {
    headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(`kdv-iade-${ay}`)}.xlsx` },
  });
}
