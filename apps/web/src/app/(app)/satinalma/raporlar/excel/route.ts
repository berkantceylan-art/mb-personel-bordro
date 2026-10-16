import ExcelJS from "exceljs";
import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { changePct, reportPeriod, type PurReport } from "@/lib/pur-report";

/** Satın alma raporu Excel (rapor ekranıyla aynı dönem) */
export async function GET(req: NextRequest) {
  const s = await getSession();
  if (Math.max(s.modules.purchases ?? 0, s.modules.finance ?? 0) < 1) return new NextResponse("Yetkiniz yok", { status: 403 });
  const q = req.nextUrl.searchParams;
  const { from, to } = reportPeriod({ bas: q.get("bas") ?? undefined, bit: q.get("bit") ?? undefined, d: q.get("d") ?? undefined });
  const { data, error } = await (await createClient()).rpc("pur_report", { p_from: from, p_to: to });
  if (error || !data) return new NextResponse(error?.message ?? "Rapor alınamadı", { status: 500 });
  const r = data as PurReport;
  const tl = (v: number) => Math.round(Number(v)) / 100;
  const wb = new ExcelJS.Workbook();
  const money = "#,##0.00 ₺";
  const head = (ws: ExcelJS.Worksheet) => { ws.getRow(1).font = { bold: true }; ws.views = [{ state: "frozen", ySplit: 1 }]; };

  const o = wb.addWorksheet("Özet");
  o.columns = [{ header: "Gösterge", key: "k", width: 36 }, { header: "Değer", key: "v", width: 22 }];
  const k = r.kpi;
  ([["Dönem", `${from} – ${to}`], ["Sipariş sayısı", k.po_n], ["Sipariş tutarı (KDV dahil, TL)", tl(k.po_total)], ["Tedarikçi", k.suppliers], ["İşlenen alış faturası", k.inv_n],
    ["Fatura toplamı (KDV dahil, TL)", tl(k.inv_total)], ["Fatura KDV hariç (TL)", tl(k.inv_net)], ["Zamanında teslim %", k.on_time_pct ?? ""], ["Ort. teslim süresi (gün)", k.lead_days ?? ""],
    ["Ort. onay süresi (saat)", k.approval_hours ?? ""], ["İstekten siparişe (gün)", k.req_to_po_days ?? ""], ["Teklif turu", k.rfq_n], ["Teklif tasarrufu (TL)", tl(k.rfq_saving)],
    ["Eksik teslimle kapanan", k.short_closed], ["Geciken açık sipariş", k.late_open]] as [string, string | number][]).forEach(([a, b]) => o.addRow({ k: a, v: b }));
  head(o);

  const m = wb.addWorksheet("Aylık");
  m.columns = [{ header: "Ay", key: "month", width: 10 }, { header: "Sipariş (TL)", key: "ordered", width: 18, style: { numFmt: money } }, { header: "Fatura (TL)", key: "invoiced", width: 18, style: { numFmt: money } }];
  r.monthly.forEach((x) => m.addRow({ month: x.month, ordered: tl(x.ordered), invoiced: tl(x.invoiced) }));
  head(m);

  const sp = wb.addWorksheet("Tedarikçiler");
  sp.columns = [{ header: "Tedarikçi", key: "name", width: 36 }, { header: "Sipariş", key: "po_n", width: 10 }, { header: "Sipariş tutarı (TL)", key: "po_total", width: 20, style: { numFmt: money } }, { header: "Fatura (TL)", key: "inv_total", width: 20, style: { numFmt: money } }];
  r.by_supplier.forEach((x) => sp.addRow({ ...x, po_total: tl(x.po_total), inv_total: tl(x.inv_total) }));
  head(sp);

  const c = wb.addWorksheet("Gider türleri");
  c.columns = [{ header: "Gider türü", key: "name", width: 30 }, { header: "KDV hariç (TL)", key: "total", width: 20, style: { numFmt: money } }];
  r.by_category.forEach((x) => c.addRow({ name: x.name, total: tl(x.total) }));
  head(c);

  const it = wb.addWorksheet("Ürünler");
  it.columns = [{ header: "Ürün", key: "name", width: 40 }, { header: "Birim", key: "unit", width: 8 }, { header: "Miktar", key: "qty", width: 10 }, { header: "Tutar (TL)", key: "total", width: 16, style: { numFmt: money } },
    { header: "Ort. fiyat", key: "avg_price", width: 14, style: { numFmt: money } }, { header: "En düşük", key: "min_price", width: 14, style: { numFmt: money } }, { header: "En yüksek", key: "max_price", width: 14, style: { numFmt: money } },
    { header: "İlk fiyat", key: "first_price", width: 14, style: { numFmt: money } }, { header: "Son fiyat", key: "last_price", width: 14, style: { numFmt: money } }, { header: "Değişim %", key: "ch", width: 11 }, { header: "Tedarikçi", key: "suppliers", width: 10 }];
  r.by_item.forEach((x) => it.addRow({ ...x, qty: Number(x.qty), total: tl(x.total), avg_price: tl(x.avg_price), min_price: tl(x.min_price), max_price: tl(x.max_price), first_price: tl(x.first_price), last_price: tl(x.last_price), ch: changePct(x.first_price, x.last_price) }));
  head(it);

  const buf = await wb.xlsx.writeBuffer();
  return new NextResponse(new Uint8Array(buf as ArrayBuffer), { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(`satin-alma-raporu-${from}-${to}`)}.xlsx` } });
}
