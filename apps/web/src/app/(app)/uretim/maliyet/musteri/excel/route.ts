import ExcelJS from "exceljs";
import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { loadCustomerMargin, productSummary } from "@/lib/customer-margin";

const m = (k: number | null) => (k == null ? null : Math.round(k) / 100);

/** Müşteri fiyatları ve kârlılık Excel: tüm müşteri × ürün satırları + ürün özeti */
export async function GET(req: NextRequest) {
  const s = await getSession();
  const lvl = Math.max(s.modules.production ?? 0, s.modules.stock ?? 0, s.modules.finance ?? 0, s.modules.sales ?? 0);
  if (lvl < 1 && !["owner", "accountant"].includes(s.role)) return new NextResponse("Yetkiniz yok", { status: 403 });
  const ay = Number(req.nextUrl.searchParams.get("ay"));
  const months = [3, 6, 12, 24].includes(ay) ? ay : 12;
  const urun = req.nextUrl.searchParams.get("urun") ?? "tumu";
  const { rows, products, error } = await loadCustomerMargin(await createClient(), months);
  if (error && !rows.length) return new NextResponse(error, { status: 500 });
  const sel = urun === "tumu" ? rows : rows.filter((r) => r.productId === urun);
  const wb = new ExcelJS.Workbook();
  const tl = "#,##0.00 ₺";
  const ws = wb.addWorksheet("Müşteri fiyatları");
  ws.columns = [
    { header: "Müşteri", key: "c", width: 30 }, { header: "Şehir", key: "city", width: 14 }, { header: "Para birimi", key: "cur", width: 10 },
    { header: "Ürün", key: "p", width: 36 }, { header: "Fiyat (müşteri p.b.)", key: "price", width: 16, style: { numFmt: "#,##0.00" } }, { header: "Fiyat türü", key: "src", width: 10 },
    { header: "Fiyat (TL)", key: "ptry", width: 14, style: { numFmt: tl } }, { header: `Adet (son ${months} ay)`, key: "q", width: 14 },
    { header: "Ciro (TL)", key: "rev", width: 16, style: { numFmt: tl } }, { header: "Fiilî ort. satış (TL)", key: "avg", width: 18, style: { numFmt: tl } },
    { header: "Üretim maliyeti", key: "prod", width: 15, style: { numFmt: tl } }, { header: "Tam maliyet", key: "cost", width: 14, style: { numFmt: tl } },
    { header: "Üye başı kâr", key: "um", width: 14, style: { numFmt: tl } }, { header: "Marj %", key: "pct", width: 9 },
    { header: "Dönem kâr / zarar", key: "profit", width: 17, style: { numFmt: tl } }, { header: "Son iş", key: "last", width: 12 },
  ];
  for (const r of [...sel].sort((a, b) => a.product.localeCompare(b.product, "tr") || (a.unitMargin ?? 1e15) - (b.unitMargin ?? 1e15))) {
    const row = ws.addRow({ c: r.customer, city: r.city ?? "", cur: r.cur, p: r.product, price: m(r.price), src: r.source, ptry: m(r.priceTry), q: r.qty, rev: m(r.revTry), avg: m(r.avgTry), prod: m(r.production), cost: m(r.cost), um: m(r.unitMargin), pct: r.marginPct, profit: m(r.profit), last: r.last ?? "" });
    if ((r.unitMargin ?? 0) < 0) row.eachCell((c) => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFDECEA" } }; });
  }
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: "frozen", ySplit: 1 }];
  ws.autoFilter = { from: "A1", to: "P1" };

  const ps = wb.addWorksheet("Ürün özeti");
  ps.columns = [
    { header: "Ürün", key: "p", width: 40 }, { header: "Müşteri", key: "n", width: 9 }, { header: "Adet", key: "q", width: 9 },
    { header: "Ciro (TL)", key: "rev", width: 16, style: { numFmt: tl } }, { header: "Ort. satış", key: "avg", width: 14, style: { numFmt: tl } },
    { header: "En düşük", key: "min", width: 13, style: { numFmt: tl } }, { header: "En yüksek", key: "max", width: 13, style: { numFmt: tl } },
    { header: "Tam maliyet", key: "cost", width: 13, style: { numFmt: tl } }, { header: "Zararda müşteri", key: "l", width: 14 }, { header: "Kâr / zarar", key: "profit", width: 16, style: { numFmt: tl } },
  ];
  for (const p of productSummary(rows, products)) ps.addRow({ p: p.name, n: p.customers, q: p.qty, rev: m(p.rev), avg: m(p.avg), min: m(p.min), max: m(p.max), cost: m(p.cost), l: p.losers, profit: m(p.profit) });
  ps.getRow(1).font = { bold: true };
  ps.views = [{ state: "frozen", ySplit: 1 }];

  const buf = await wb.xlsx.writeBuffer();
  return new NextResponse(buf as ArrayBuffer, {
    headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="musteri-fiyat-karlilik-${months}ay.xlsx"` },
  });
}
