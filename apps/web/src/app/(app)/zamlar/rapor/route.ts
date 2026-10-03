import ExcelJS from "exceljs";
import { NextResponse, type NextRequest } from "next/server";
import { groupRaises, loadRaises } from "@/lib/raises";
import { canManagePay, getSession, periodLabel } from "@/lib/session";

const money = '#,##0.00 "₺"';

export async function GET(req: NextRequest) {
  const s = await getSession();
  if (!canManagePay(s.role)) return new NextResponse("Yetkiniz yok", { status: 403 });
  const year = Number(req.nextUrl.searchParams.get("yil")) || new Date().getFullYear();
  const dept = req.nextUrl.searchParams.get("bolum") || undefined;
  const rows = await loadRaises(year, dept);

  const wb = new ExcelJS.Workbook();
  wb.creator = "MB Personel & Bordro";
  const header = (ws: ExcelJS.Worksheet) => {
    const r = ws.getRow(1);
    r.font = { bold: true, color: { argb: "FFFFFFFF" } };
    r.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0A3D73" } };
    ws.views = [{ state: "frozen", ySplit: 1 }];
  };
  const L = (k: number) => k / 100;

  const m = wb.addWorksheet("Aylara göre");
  m.columns = [
    { header: "Ay", key: "ay", width: 16 },
    { header: "Zam alan kişi", key: "kisi", width: 14 },
    { header: "Ortalama %", key: "pct", width: 12 },
    { header: "Önceki aylık toplam", key: "once", width: 20, style: { numFmt: money } },
    { header: "Yeni aylık toplam", key: "sonra", width: 20, style: { numFmt: money } },
    { header: "Aylık artış", key: "artis", width: 18, style: { numFmt: money } },
  ];
  groupRaises(rows, (r) => r.period).sort((a, b) => a.key.localeCompare(b.key)).forEach((g) =>
    m.addRow({ ay: periodLabel(g.key), kisi: g.count, pct: g.avgPct, once: L(g.before), sonra: L(g.after), artis: L(g.increase) }),
  );
  header(m);

  const d = wb.addWorksheet("Bölümlere göre");
  d.columns = [
    { header: "Bölüm", key: "bolum", width: 22 },
    { header: "Zam alan kişi", key: "kisi", width: 14 },
    { header: "Ortalama %", key: "pct", width: 12 },
    { header: "Önceki aylık toplam", key: "once", width: 20, style: { numFmt: money } },
    { header: "Yeni aylık toplam", key: "sonra", width: 20, style: { numFmt: money } },
    { header: "Aylık artış", key: "artis", width: 18, style: { numFmt: money } },
  ];
  groupRaises(rows, (r) => r.department_name ?? "Bölümsüz").sort((a, b) => a.key.localeCompare(b.key, "tr")).forEach((g) =>
    d.addRow({ bolum: g.key, kisi: g.count, pct: g.avgPct, once: L(g.before), sonra: L(g.after), artis: L(g.increase) }),
  );
  header(d);

  const p = wb.addWorksheet("Personel");
  p.columns = [
    { header: "Geçerlilik", key: "tarih", width: 12 },
    { header: "Ad", key: "ad", width: 16 },
    { header: "Soyad", key: "soyad", width: 16 },
    { header: "Bölüm", key: "bolum", width: 20 },
    { header: "Önceki ücret", key: "once", width: 16, style: { numFmt: money } },
    { header: "Yeni ücret", key: "sonra", width: 16, style: { numFmt: money } },
    { header: "Artış", key: "artis", width: 14, style: { numFmt: money } },
    { header: "%", key: "pct", width: 8 },
    { header: "Toplu zam", key: "toplu", width: 10 },
    { header: "Açıklama", key: "aciklama", width: 28 },
  ];
  rows
    .slice()
    .sort((a, b) => (a.department_name ?? "").localeCompare(b.department_name ?? "", "tr") || a.effective_date.localeCompare(b.effective_date))
    .forEach((r) =>
      p.addRow({
        tarih: new Date(r.effective_date + "T00:00:00Z"),
        ad: r.first_name,
        soyad: r.last_name,
        bolum: r.department_name ?? "",
        once: L(r.previous_total_net),
        sonra: L(r.total_net),
        artis: L(r.increase),
        pct: r.increase_pct,
        toplu: r.raise_batch_id ? "Evet" : "",
        aciklama: r.change_reason ?? "",
      }),
    );
  p.getColumn("tarih").numFmt = "dd.mm.yyyy";
  header(p);

  const buf = await wb.xlsx.writeBuffer();
  const name = `zam-raporu-${year}${dept ? "-" + dept.toLocaleLowerCase("tr").replace(/\s+/g, "-") : ""}.xlsx`;
  return new NextResponse(buf as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
    },
  });
}
